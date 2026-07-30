"""Project functions for handling API requests from front-end."""

import asyncio
import ssl
import time
import urllib.parse

import aioboto3
import aiohttp.web
import aiohttp_session
import botocore.exceptions
import certifi

from swift_browser_ui.ui._convenience import (
    ldap_get_project_titles,
)
from swift_browser_ui.ui.replicate import ObjectReplicator
from swift_browser_ui.ui.settings import setd

ssl_context = ssl.create_default_context()
ssl_context.load_verify_locations(certifi.where())


async def get_os_user(request: aiohttp.web.Request) -> aiohttp.web.Response:
    """Fetch the session owning OS user."""
    session = await aiohttp_session.get_session(request)
    request.app["Log"].info(
        f"API call for username from {request.remote}, sess: {session} :: {time.ctime()}"
    )
    return aiohttp.web.json_response(session["uname"])


async def os_list_projects(request: aiohttp.web.Request) -> aiohttp.web.Response:
    """Fetch the projects available for the open session."""
    session = await aiohttp_session.get_session(request)
    request.app["Log"].info(
        "API call for project listing from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )
    # Fetch project title information from ldap. A dead/unreachable LDAP must
    # not break the project listing — degrade to empty titles instead.
    try:
        titles = await ldap_get_project_titles(session["projects"])
    except Exception:
        request.app["Log"].error("Failed to fetch project titles from LDAP")
        titles = {}
    # Filter out the tokens contained in session token
    return aiohttp.web.json_response(
        [
            {
                "name": v["name"],
                "title": titles.get(v["name"].split("_")[-1], ""),
                "id": v["id"],
                "tainted": v["tainted"],
            }
            for _, v in session["projects"].items()
        ]
    )


# TODO(swift-deprecation): this whole section (helpers +
# swift_get_container_public + swift_set_container_public) is
# transitional glue that only exists to keep the public toggle in sync
# with the Swift UI. When Swift is deprecated, delete the section and
# its two routes in server.py — public access itself is granted by the
# bucket policy and keeps working. The frontend counterpart to update
# is getBucketPublicStatus/setBucketPublic in s3commands.js.
#
# Public read access lives in the Swift container read ACL as the
# ".r:*,.rlistings" tokens — the same markers the Swift UI uses. This is
# deliberate: RGW maps Swift ACL tokens to internal permission bits
# (READ_OBJS + referer grants) that the S3 ACL API can neither produce
# nor see, so the only way to stay in sync with the Swift UI is to edit
# the container ACL through the Swift API. The frontend additionally
# mirrors the state into a bucket policy, which is what actually grants
# anonymous object reads on the S3 endpoint.
PUBLIC_READ_TOKENS = [".r:*", ".rlistings"]


def _split_acl(acl: str) -> list[str]:
    """Split ACL string into list of entries."""
    if not acl:
        return []
    return [a.strip() for a in acl.split(",") if a.strip()]


def _join_acl(parts: list[str]) -> str:
    """Join ACL entries into a string, removing duplicates while preserving order."""
    seen = set()
    out = []
    for p in parts:
        if p not in seen:
            out.append(p)
            seen.add(p)
    return ",".join(out)


def _enable_public_read(read_acl: str) -> str:
    """Enable public read access in the ACL string."""
    parts = _split_acl(read_acl)
    for tok in PUBLIC_READ_TOKENS:
        if tok not in parts:
            parts.append(tok)
    return _join_acl(parts)


def _disable_public_read(read_acl: str) -> str:
    """Disable public read access in the ACL string."""
    parts = [p for p in _split_acl(read_acl) if p not in PUBLIC_READ_TOKENS]
    return _join_acl(parts)


def _is_public_read(read_acl: str) -> bool:
    """Check if ACL string has public read access enabled."""
    parts = set(_split_acl(read_acl))
    return all(tok in parts for tok in PUBLIC_READ_TOKENS)


async def swift_get_container_public(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Get the public read access status and public address of a container."""
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    project = request.match_info["project"]
    container = request.match_info["container"]
    request.app["Log"].info(
        "API call for container public status from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )

    try:
        endpoint = session["projects"][project]["endpoint"]
        token = session["projects"][project]["token"]
    except KeyError:
        raise aiohttp.web.HTTPForbidden(
            reason="Account does not have access to the project."
        )

    async with client.head(
        f"{endpoint}/{container}",
        headers={"X-Auth-Token": token},
    ) as ret:
        if ret.status == 404:
            raise aiohttp.web.HTTPNotFound(reason=f"Container not found: {container}")
        if ret.status not in {200, 204}:
            raise aiohttp.web.HTTPForbidden(
                reason=f"Failed to read container ACL: {container}"
            )
        read_acl = ret.headers.get("X-Container-Read", "")

    # The trailing slash matters: without it RGW redirects to a URL
    # missing the AUTH_ segment, which breaks the anonymous listing
    return aiohttp.web.json_response(
        {
            "public": _is_public_read(read_acl),
            "address": f"{endpoint}/{urllib.parse.quote(container)}/",
        }
    )


async def swift_set_container_public(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Set the public read access for a container."""
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    project = request.match_info["project"]
    container = request.match_info["container"]
    request.app["Log"].info(
        "API call for setting container public status from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )

    enabled_str = request.query.get("enabled", "").lower()
    if enabled_str not in {"true", "false"}:
        raise aiohttp.web.HTTPBadRequest(reason="Missing or invalid ?enabled=true|false")
    enabled = enabled_str == "true"

    try:
        endpoint = session["projects"][project]["endpoint"]
        token = session["projects"][project]["token"]
    except KeyError:
        raise aiohttp.web.HTTPForbidden(
            reason="Account does not have access to the project."
        )

    async def _apply(name: str, *, allow_missing: bool) -> None:
        headers = {"X-Auth-Token": token}
        async with client.head(f"{endpoint}/{name}", headers=headers) as ret:
            if ret.status == 404:
                if allow_missing:
                    return
                raise aiohttp.web.HTTPNotFound(reason=f"Container not found: {name}")
            if ret.status not in {200, 204}:
                raise aiohttp.web.HTTPForbidden(
                    reason=f"Failed to read container ACL: {name}"
                )
            read_acl = ret.headers.get("X-Container-Read", "")

        headers["X-Container-Read"] = (
            _enable_public_read(read_acl) if enabled else _disable_public_read(read_acl)
        )

        async with client.post(f"{endpoint}/{name}", headers=headers) as ret:
            if ret.status != 204:
                raise aiohttp.web.HTTPForbidden(reason="Failed to update container ACL")

    await _apply(container, allow_missing=False)
    # Legacy Swift large objects keep their data in a twin segments
    # bucket; mirror the state there like the Swift UI does
    await _apply(f"{container}_segments", allow_missing=True)

    return aiohttp.web.Response(status=204)


async def aws_list_buckets(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Proxy bucket list request to a compatible AWS API."""
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    logger = request.app["Log"]
    project = request.match_info["project"]

    continuation_token = request.query.get("continuation_token", "")
    max_buckets = int(request.query.get("max_buckets", 1000))

    logger.info(
        f"API call to list buckets in {project} from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )
    logger.debug(
        f"Using {max_buckets} as max buckets and {continuation_token} "
        "as the continuation token."
    )

    creds = await _get_ec2_credentials(session, client, project)
    s3session = aioboto3.Session(
        aws_access_key_id=creds["access"],
        aws_secret_access_key=creds["secret"],
    )

    async with s3session.client(
        "s3",
        region_name="us-east-1",
        endpoint_url=setd["s3api_endpoint"],
        verify=setd["check_certificate"],
    ) as s3_client:
        try:
            bucket_page = await s3_client.list_buckets(
                MaxBuckets=max_buckets,
                ContinuationToken=continuation_token,
            )
        except botocore.exceptions.ClientError as e:
            error_code = e.response["Error"]["Code"]
            http_status = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            logger.info(
                f"ListBuckets failed for {project} with error code "
                f"{error_code} (HTTP {http_status})."
            )
            if error_code == "404" or http_status == 404:
                raise aiohttp.web.HTTPNotFound(
                    text="Project doesn't have any buckets or storage access."
                )
            # RGW rejects a suspended or otherwise inaccessible tenant with a
            # symbolic error code and HTTP 401/403 — not a literal "401".
            if error_code in {
                "401",
                "AccessDenied",
                "UserSuspended",
                "InvalidAccessKeyId",
                "SignatureDoesNotMatch",
            } or http_status in {401, 403}:
                raise aiohttp.web.HTTPUnauthorized(
                    text="Unauthorized. Project storage might be suspended "
                    "or credentials stale."
                )
            raise aiohttp.web.HTTPInternalServerError(
                text="Couldn't retrieve the bucket page from storage."
            )

    bucket_page["Buckets"] = [
        {
            "Name": bucket["Name"],
            "CreationDate": bucket["CreationDate"].isoformat(),
        }
        for bucket in bucket_page["Buckets"]
    ]

    return aiohttp.web.json_response(bucket_page)


async def aws_preview_object(
    request: aiohttp.web.Request,
) -> aiohttp.web.StreamResponse:
    """Stream an object inline for in-browser preview.

    Session-authenticated: the URL only works for logged-in members of
    the project, it is not a public link.
    """
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    logger = request.app["Log"]
    project = request.match_info["project"]
    bucket = request.match_info["bucket"]
    object_name = urllib.parse.unquote(request.match_info["object"])

    logger.info(
        f"API call to preview object in bucket {bucket} in {project} from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )

    creds = await _get_ec2_credentials(session, client, project)
    s3session = aioboto3.Session(
        aws_access_key_id=creds["access"],
        aws_secret_access_key=creds["secret"],
    )

    async with s3session.client(
        "s3",
        region_name="us-east-1",
        endpoint_url=setd["s3api_endpoint"],
        verify=setd["check_certificate"],
    ) as s3_client:
        get_kwargs = {"Bucket": bucket, "Key": object_name}
        # Forward Range for PDF/video seeking if present
        range_hdr = request.headers.get("Range")
        if range_hdr:
            get_kwargs["Range"] = range_hdr

        try:
            obj = await s3_client.get_object(**get_kwargs)
        except botocore.exceptions.ClientError as e:
            error_code = e.response["Error"]["Code"]
            http_status = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if error_code in {"NoSuchKey", "NoSuchBucket", "404"} or http_status == 404:
                raise aiohttp.web.HTTPNotFound(text="Object not found.")
            if error_code in {
                "AccessDenied",
                "401",
                "InvalidAccessKeyId",
                "SignatureDoesNotMatch",
            } or http_status in {401, 403}:
                raise aiohttp.web.HTTPUnauthorized(text="No access to the object.")
            raise aiohttp.web.HTTPInternalServerError(
                text="Could not fetch the object for preview."
            )

        resp = aiohttp.web.StreamResponse(
            status=206 if "ContentRange" in obj else 200,
        )

        ctype = obj.get("ContentType") or "application/octet-stream"
        # Ensure text/* types have charset
        if ctype.startswith("text/") and "charset=" not in ctype.lower():
            ctype = f"{ctype}; charset=utf-8"
        resp.headers["Content-Type"] = ctype

        # Force inline preview
        filename = object_name.split("/")[-1].replace('"', "")
        resp.headers["Content-Disposition"] = f'inline; filename="{filename}"'

        if "ContentLength" in obj:
            resp.headers["Content-Length"] = str(obj["ContentLength"])
        if "ContentRange" in obj:
            resp.headers["Content-Range"] = obj["ContentRange"]
        if "AcceptRanges" in obj:
            resp.headers["Accept-Ranges"] = obj["AcceptRanges"]
        if "ETag" in obj:
            resp.headers["ETag"] = obj["ETag"]

        await resp.prepare(request)
        body = obj["Body"]
        while True:
            chunk = await body.read(65536)
            if not chunk:
                break
            await resp.write(chunk)
        await resp.write_eof()
        return resp


async def aws_create_bucket(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Proxy bucket creation request to a compatible AWS API."""
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    logger = request.app["Log"]
    project = request.match_info["project"]
    bucket = request.match_info["bucket"]

    logger.info(
        f"API call to create bucket {bucket} in {project} from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )

    creds = await _get_ec2_credentials(session, client, project)
    s3session = aioboto3.Session(
        aws_access_key_id=creds["access"],
        aws_secret_access_key=creds["secret"],
    )

    async with s3session.client(
        "s3",
        region_name="us-east-1",
        endpoint_url=setd["s3api_endpoint"],
        verify=setd["check_certificate"],
    ) as s3_client:
        try:
            await s3_client.create_bucket(Bucket=bucket)
        except botocore.exceptions.ClientError as e:
            error_code = e.response["Error"]["Code"]
            http_status = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            logger.info(
                f"CreateBucket failed for {bucket} in {project} with error code "
                f"{error_code} (HTTP {http_status})."
            )
            # RGW/S3 report the error as a symbolic string code, not an int.
            if (
                error_code in {"BucketAlreadyExists", "BucketAlreadyOwnedByYou"}
                or http_status == 409
            ):
                raise aiohttp.web.HTTPConflict(text="Bucket already exists")
            if error_code in {
                "AccessDenied",
                "UserSuspended",
                "InvalidAccessKeyId",
                "SignatureDoesNotMatch",
            } or http_status in {401, 403}:
                raise aiohttp.web.HTTPUnauthorized(
                    text="Unauthorized. Project storage might be suspended "
                    "or credentials stale."
                )
            if http_status == 400:
                raise aiohttp.web.HTTPBadRequest(
                    text="Could not create requested bucket."
                )
            raise aiohttp.web.HTTPInternalServerError(
                text="Could not create requested bucket."
            )

    # Add CORS entries for the newly created bucket to allow access via browser
    await _update_bucket_cors(logger, s3session, bucket)

    return aiohttp.web.Response(status=204, body="")


async def _update_bucket_cors(
    logger,
    s3session: aioboto3.Session,
    bucket: str,
):
    """Update single bucket cors entry."""
    async with s3session.client(
        "s3",
        region_name="us-east-1",
        endpoint_url=setd["s3api_endpoint"],
        verify=setd["check_certificate"],
    ) as s3_client:
        # Fetch the existing bucket CORS information
        cors_list = []
        try:
            cors_response = await s3_client.get_bucket_cors(Bucket=bucket)
            cors_list = cors_response.get("CORSRules", [])
        except botocore.exceptions.ClientError as e:
            error_code = e.response["Error"]["Code"]
            if error_code == 404 or error_code == "NoSuchCORSConfiguration":
                # 404 means there's no existing CORS
                logger.debug(f"No existing CORS in {bucket}, creating from scratch.")
                pass
            elif error_code == 400:
                raise aiohttp.web.HTTPClientError
            else:
                raise aiohttp.web.HTTPInternalServerError
        except botocore.exceptions.ParamValidationError:
            # We don't need to care about the bucket name validation errors for old buckets.
            return

        # Skip immediately if the required CORS entry already exists
        for cors in cors_list:
            if setd["web_app_cors_origin"] in cors["AllowedOrigins"]:
                return

        # Append the SD Connect UI to the CORS listing
        try:
            cors_list.append(
                {
                    "AllowedHeaders": [
                        "*",
                    ],
                    "AllowedMethods": [
                        "PUT",
                        "GET",
                        "DELETE",
                        "POST",
                        "HEAD",
                    ],
                    "AllowedOrigins": [
                        setd["web_app_cors_origin"],
                        f"{setd['web_app_cors_origin']}/",
                    ],
                    "ExposeHeaders": [
                        "*",
                    ],
                    "MaxAgeSeconds": 3600,
                }
            )
            await s3_client.put_bucket_cors(
                Bucket=bucket,
                CORSConfiguration={
                    "CORSRules": cors_list,
                },
            )
        except botocore.exceptions.ClientError as e:
            error_code = e.response["Error"]["Code"]
            raise aiohttp.web.HTTPInternalServerError(
                text=f"Could not add the CORS entry to bucket {bucket}, status {error_code}"
            )


async def aws_update_bucket_cors(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Update a bucket acl to allow access from the configured UI address."""
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    logger = request.app["Log"]
    project = request.match_info["project"]
    bucket = request.match_info["bucket"]

    logger.info(
        f"API call to update {bucket} CORS in {project} from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )

    creds = await _get_ec2_credentials(session, client, project)
    s3session = aioboto3.Session(
        aws_access_key_id=creds["access"],
        aws_secret_access_key=creds["secret"],
    )

    await _update_bucket_cors(logger, s3session, bucket)

    return aiohttp.web.Response(status=204, body="")


async def aws_bulk_update_bucket_cors(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Update project buckets with project UI cors."""
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    logger = request.app["Log"]
    project = request.match_info["project"]

    buckets = [b for b in request.query.get("buckets", "").split(";") if b]

    logger.info(
        f"API call to allow CORS for all buckets in {project} from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )

    creds = await _get_ec2_credentials(session, client, project)
    s3session = aioboto3.Session(
        aws_access_key_id=creds["access"],
        aws_secret_access_key=creds["secret"],
    )

    async with s3session.client(
        "s3",
        region_name="us-east-1",
        endpoint_url=setd["s3api_endpoint"],
        verify=setd["check_certificate"],
    ) as s3_client:
        # If we got a list of buckets, just use that instead of paging
        # through the whole project
        if buckets:
            for bucket in buckets:
                try:
                    await _update_bucket_cors(logger, s3session, bucket)
                except Exception as e:
                    request.app["Log"].error(
                        f"Failed to bulk add CORS to bucket {bucket} for reason {e}",
                    )

            return aiohttp.web.Response(status=204, body="")

        continuation_token = ""  # nosec
        try:
            # Using the anti-pattern while since we need to check the continuation token
            # in the end of loop execution, not start
            while True:
                bucket_page = await s3_client.list_buckets(
                    MaxBuckets=100,
                    ContinuationToken=continuation_token,
                )

                # Immediately apply new cors to the bucket
                for aws_bucket in bucket_page["Buckets"]:
                    try:
                        await _update_bucket_cors(logger, s3session, aws_bucket["Name"])
                    except Exception as e:
                        request.app["Log"].error(
                            f"Failed to bulk add CORS to bucket "
                            f"{aws_bucket['Name']} for reason {e}",
                        )

                # End execution if API tells us there's no more pages
                if (
                    "ContinuationToken" in bucket_page
                    and bucket_page["ContinuationToken"]
                ):
                    continuation_token = bucket_page["ContinuationToken"]
                else:
                    break

        except botocore.exceptions.ClientError as e:
            error_code = e.response["Error"]["Code"]
            raise aiohttp.web.HTTPInternalServerError(
                text=f"Could not retrieve bucket page for {project}, status {error_code}"
            )

    return aiohttp.web.Response(status=204, body="")


async def _get_ec2_credentials(session, client, project) -> dict:
    """Return access key and secret key for the given project."""
    # Return credentials from cache if they exist
    if "ec2" in session["projects"][project]:
        return session["projects"][project]["ec2"]

    # Check if there are existing credentials, use the first one
    async with client.get(
        f"{setd['auth_endpoint_url']}/users/{session['uid']}/credentials/OS-EC2",
        headers={
            "X-Auth-Token": session["projects"][project]["token"],
        },
    ) as ret:
        creds = await ret.json()
        keys = list(
            filter(
                lambda key: key["tenant_id"] == project,
                creds["credentials"],
            )
        )

    if len(keys) > 0:
        return keys[0]

    # Create new credentials if there are no existing ones
    async with client.post(
        f"{setd['auth_endpoint_url']}/users/{session['uid']}/credentials/OS-EC2",
        headers={
            "X-Auth-Token": session["projects"][project]["token"],
        },
        json={
            "tenant_id": project,
        },
    ) as ret:
        session["projects"][project]["ec2"] = (await ret.json())["credential"]
        session.changed()
        return session["projects"][project]["ec2"]


async def keystone_gen_ec2(request: aiohttp.web.Request) -> aiohttp.web.Response:
    """Acquire and serve EC2 credentials for the given project."""
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    project = request.match_info["project"]

    request.app["Log"].info(
        f"API call for fetching ec2 credentials from {request.remote}, sess {session}"
    )

    # Fetch the ec2 credentials if they're not already cached in the session.
    return aiohttp.web.json_response(await _get_ec2_credentials(session, client, project))


async def replicate_bucket(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Replicate bucket using ec2 credentials."""
    session = await aiohttp_session.get_session(request)
    client = request.app["api_client"]
    logger = request.app["Log"]

    project = request.match_info["project"]
    bucket = request.match_info["bucket"]
    source_bucket = request.query["from_bucket"]
    source_project = request.query["from_project"]

    logger.info(
        f"API call to replicate bucket {source_bucket} to {bucket} from "
        f"{request.remote}, sess: {session} :: {time.ctime()}"
    )

    creds = await _get_ec2_credentials(session, client, project)

    s3session = aioboto3.Session(
        aws_access_key_id=creds["access"],
        aws_secret_access_key=creds["secret"],
    )

    s3_client_context = s3session.client(
        "s3",
        region_name="us-east-1",
        endpoint_url=setd["s3api_endpoint"],
        verify=setd["check_certificate"],
    )

    s3_client = await s3_client_context.__aenter__()

    replicator = ObjectReplicator(
        s3_client,
        project,
        bucket,
        source_project,
        source_bucket,
    )

    # Create destination bucket
    await replicator.create_destination_bucket()
    # Add CORS entries for the newly created bucket to allow access via browser
    await _update_bucket_cors(logger, s3session, bucket)

    async def run_replication() -> None:
        try:
            await replicator.replicate_objects()
        finally:
            await s3_client_context.__aexit__(None, None, None)

    asyncio.create_task(run_replication())

    return aiohttp.web.HTTPAccepted(text="Replication started")
