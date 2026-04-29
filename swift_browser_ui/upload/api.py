"""API handlers for swift-upload-runner."""

import asyncio
import logging
import os
import time
import typing
import uuid

import aiohttp.web
import msgpack

import swift_browser_ui.upload.cryptupload as cryptupload
from swift_browser_ui.upload.common import (
    generate_download_url,
    get_download_host,
    get_session_id,
)
from swift_browser_ui.upload.replicate import ObjectReplicationProxy

LOGGER = logging.getLogger(__name__)
LOGGER.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

CRYPTUPLOAD_Q_DEPTH = int(os.environ.get("SWIFTUI_UPLOAD_RUNNER_Q_DEPTH", 96))


async def handle_get_object(request: aiohttp.web.Request) -> aiohttp.web.Response:
    """Handle a request for getting object content."""
    session = request.app[get_session_id(request)]

    project = request.match_info["project"]
    container = request.match_info["container"]
    object_name = request.match_info["object_name"]

    LOGGER.info(
        f"Downloading from project {project}, "
        f"from container {container}, "
        f"the file {object_name}"
    )

    headers = {
        "X-Auth-Token": session["token"],
        "Accept-Encoding": "identity",
    }
    if "Range" in request.headers:
        headers["Range"] = request.headers["Range"]
        LOGGER.info(
            f"Downloading a byte range {headers['Range']} for object {object_name}"
        )

    obj = await request.app["client"].get(
        generate_download_url(
            get_download_host(session["endpoint"], project),
            container=container,
            object_name=object_name,
        ),
        headers=headers,
        params=request.query,
    )

    resp = aiohttp.web.Response(
        body=obj.content.iter_chunked(131072),
        headers={
            "Content-Type": obj.headers["Content-Type"],
            "Content-Length": obj.headers["Content-Length"],
        },
    )
    return resp


async def handle_replicate_container(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Handle request to replicating a container from a source."""
    session = get_session_id(request)

    project = request.match_info["project"]
    container = request.match_info["container"]

    source_project = request.query["from_project"]
    source_container = request.query["from_container"]

    replicator = ObjectReplicationProxy(
        request.app[session],
        request.app["client"],
        project,
        container,
        source_project,
        source_container,
        request.query["project_name"] if "project_name" in request.query else "",
        (
            request.query["from_project_name"]
            if "from_project_name" in request.query
            else ""
        ),
    )

    # Ensure that both containers exist
    await replicator.a_ensure_container()
    await replicator.a_ensure_container(segmented=True)

    job_id = uuid.uuid4().hex[:12]

    # create job record
    request.app["replication_jobs"][job_id] = {
        "state": "running",  # running | finished | failed | cancelled
        "done": 0,
        "total": 0,
        "error": "",
        "cancel": False,
    }

    async def runner():
        try:
            await replicator.a_copy_from_container(job_id=job_id, app=request.app)
            request.app["replication_jobs"][job_id]["state"] = "finished"
        except asyncio.CancelledError:
            request.app["replication_jobs"][job_id]["state"] = "cancelled"
            return
        except Exception as e:
            request.app["replication_jobs"][job_id]["state"] = "failed"
            request.app["replication_jobs"][job_id]["error"] = str(e)
            return

    task = asyncio.create_task(runner())
    request.app["replication_jobs"][job_id]["task"] = task

    return aiohttp.web.json_response({"job_id": job_id}, status=202)


async def handle_replicate_object(request: aiohttp.web.Request) -> aiohttp.web.Response:
    """Handle a request to replicating an object from a source."""
    session = get_session_id(request)

    project = request.match_info["project"]
    container = request.match_info["container"]

    source_project = request.query["from_project"]
    source_container = request.query["from_container"]
    source_object = request.query["from_object"]

    replicator = ObjectReplicationProxy(
        request.app[session],
        request.app["client"],
        project,
        container,
        source_project,
        source_container,
        request.query["project_name"] if "project_name" in request.query else "",
        (
            request.query["from_project_name"]
            if "from_project_name" in request.query
            else ""
        ),
    )

    # Ensure that both containers exist
    await replicator.a_ensure_container()
    await replicator.a_ensure_container(segmented=True)

    asyncio.ensure_future(replicator.a_copy_single_object(source_object))

    return aiohttp.web.Response(status=202)


async def handle_replicate_status(request):
    """Handle a request for getting replication job status."""
    job_id = request.match_info["job_id"]
    job = request.app["replication_jobs"].get(job_id)
    if not job:
        raise aiohttp.web.HTTPNotFound(reason="Job not found")

    return aiohttp.web.json_response(
        {
            "state": job["state"],
            "done": job["done"],
            "total": job["total"],
            "error": job.get("error", ""),
        }
    )


async def handle_replicate_cancel(request):
    """Handle a request for cancelling a replication job."""
    job_id = request.match_info["job_id"]
    job = request.app["replication_jobs"].get(job_id)
    if not job:
        raise aiohttp.web.HTTPNotFound(reason="Job not found")

    job["cancel"] = True
    task = job.get("task")
    if task and not task.done():
        task.cancel()

    return aiohttp.web.json_response({"ok": True})


async def handle_post_object_chunk(request: aiohttp.web.Request) -> aiohttp.web.Response:
    """Handle a request for posting an object chunk."""
    if "from_object" in request.query.keys():
        return await handle_replicate_object(request)
    if "from_container" in request.query.keys():
        return await handle_replicate_container(request)

    raise aiohttp.web.HTTPGone()


async def handle_post_object_options(
    _: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Handle options request for posting the object chunk."""
    resp = aiohttp.web.Response(
        headers={
            "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
            "Access-Control-Max-Age": "84600",
        }
    )

    return resp


async def handle_download_shared_object_options(
    _: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Handle options for downloading shared objects."""
    resp = aiohttp.web.Response(
        headers={
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Max-Age": "84600",
            "Access-Control-Allow-Headers": "Content-Type, Range",
        }
    )

    return resp


async def handle_upload_ws(
    request: aiohttp.web.Request,
) -> aiohttp.web.WebSocketResponse:
    """Handle parallel file upload data via a websocket."""
    upload_session: cryptupload.UploadSession = cryptupload.get_encrypted_upload_session(
        request
    )

    ws = aiohttp.web.WebSocketResponse()
    await ws.prepare(request)

    upload_session.set_ws(ws)

    LOGGER.info(f"Upload session websocket opened for {request.url.path}")

    async for msg in ws:
        if msg.type == "close":
            await upload_session.handle_close()
            LOGGER.info(f"Closing the websocket for {request.url.path}")
            await ws.close()

        # Open msgpack and handle message
        try:
            msg_unpacked: typing.Dict[str, typing.Any] = msgpack.unpackb(msg.data)

            if msg_unpacked["command"] == "start_upload":
                await upload_session.handle_begin_upload(msg_unpacked)
            if msg_unpacked["command"] == "add_chunk":
                await upload_session.handle_upload_chunk(msg_unpacked)
            if msg_unpacked["command"] == "add_chunks":
                await upload_session.handle_upload_chunks(msg_unpacked)
            if msg_unpacked["command"] == "cancel":
                await upload_session.handle_close()
            if msg_unpacked["command"] == "finish":
                await upload_session.handle_finish_upload(msg_unpacked)
        except ValueError:
            LOGGER.error("Received an empty message.")
            LOGGER.debug(msg.data)
        except msgpack.exceptions.ExtraData:
            LOGGER.error("Extra data in message.")
            LOGGER.debug(msg.data)
        except msgpack.exceptions.FormatError:
            LOGGER.error("Incorrectly formatted message.")
            LOGGER.error(msg.data)

    return ws


async def handle_health_check(request: aiohttp.web.Request) -> aiohttp.web.Response:
    """Answer a service health check for the upload runner."""
    start_time = time.time()
    end_time = time.time()

    return aiohttp.web.json_response(
        {
            "upload-runner": {"status": "Ok"},
            "start-time": start_time,
            "end-time": end_time,
        }
    )