"""Module for testing ``swift_browser_ui.ui.api``."""

import datetime
import types
import unittest
import unittest.mock

import aiohttp.web
import botocore.exceptions

import tests.common.mockups
import swift_browser_ui.ui.api

api = swift_browser_ui.ui.api


class ACLHelperTestClass(unittest.TestCase):
    """Test the pure Swift-ACL helper functions.

    These are sync and side-effect free, so no mocks are needed. The
    public-read markers live in ``PUBLIC_READ_TOKENS``; the helpers must
    stay in sync with those exact values.
    """

    def test_public_read_tokens_constant(self):
        """The public-read markers are the Swift ACL tokens."""
        self.assertEqual(api.PUBLIC_READ_TOKENS, [".r:*", ".rlistings"])

    def test_split_acl(self):
        """_split_acl trims, drops empties and returns a list of tokens."""
        cases = [
            ("", []),
            (".r:*", [".r:*"]),
            (".r:*,.rlistings", [".r:*", ".rlistings"]),
            ("  .r:* , .rlistings ", [".r:*", ".rlistings"]),
            (",,,", []),
            ("a,,b", ["a", "b"]),
        ]
        for raw, expected in cases:
            with self.subTest(raw=raw):
                self.assertEqual(api._split_acl(raw), expected)

    def test_join_acl(self):
        """_join_acl joins, dedups and preserves first-seen order."""
        cases = [
            ([], ""),
            (["a"], "a"),
            (["a", "b"], "a,b"),
            (["a", "a", "b"], "a,b"),
            ([".r:*", ".rlistings", ".r:*"], ".r:*,.rlistings"),
            (["b", "a", "b"], "b,a"),
        ]
        for parts, expected in cases:
            with self.subTest(parts=parts):
                self.assertEqual(api._join_acl(parts), expected)

    def test_split_join_roundtrip(self):
        """A clean ACL string survives a split/join round-trip."""
        for acl in ["", ".r:*", ".r:*,.rlistings", "user:proj,.r:*,.rlistings"]:
            with self.subTest(acl=acl):
                self.assertEqual(api._join_acl(api._split_acl(acl)), acl)

    def test_enable_public_read_adds_both_tokens(self):
        """_enable_public_read appends both public tokens to an ACL."""
        self.assertEqual(api._enable_public_read(""), ".r:*,.rlistings")
        self.assertEqual(
            api._enable_public_read("user:proj"),
            "user:proj,.r:*,.rlistings",
        )

    def test_enable_public_read_is_idempotent(self):
        """Enabling an already-public ACL keeps it unchanged (no dupes)."""
        already = ".r:*,.rlistings"
        self.assertEqual(api._enable_public_read(already), already)
        # Only .r:* present -> the missing .rlistings is appended once.
        self.assertEqual(api._enable_public_read(".r:*"), ".r:*,.rlistings")

    def test_disable_public_read_removes_tokens(self):
        """_disable_public_read strips both public tokens, keeps the rest."""
        self.assertEqual(api._disable_public_read(".r:*,.rlistings"), "")
        self.assertEqual(
            api._disable_public_read("user:proj,.r:*,.rlistings"),
            "user:proj",
        )

    def test_disable_public_read_noop_when_not_public(self):
        """Disabling a non-public ACL is a no-op."""
        self.assertEqual(api._disable_public_read("user:proj"), "user:proj")
        self.assertEqual(api._disable_public_read(""), "")

    def test_is_public_read_requires_all_tokens(self):
        """_is_public_read is True only when *both* public tokens present."""
        self.assertTrue(api._is_public_read(".r:*,.rlistings"))
        self.assertTrue(api._is_public_read("user:proj,.r:*,.rlistings"))
        # A single token is not enough (helper uses all()).
        self.assertFalse(api._is_public_read(".r:*"))
        self.assertFalse(api._is_public_read(".rlistings"))
        self.assertFalse(api._is_public_read(""))
        self.assertFalse(api._is_public_read("user:proj"))

    def test_enable_then_is_public_transition(self):
        """enable -> is_public True; disable -> is_public False."""
        enabled = api._enable_public_read("user:proj")
        self.assertTrue(api._is_public_read(enabled))
        disabled = api._disable_public_read(enabled)
        self.assertFalse(api._is_public_read(disabled))
        self.assertEqual(disabled, "user:proj")


class APITestClass(tests.common.mockups.APITestBase):
    """Test the Object Browser API."""

    def setUp(self):
        """Set up mocks."""
        super().setUp()

    # -- shared S3 mocking helpers -------------------------------------

    def _creds_patch(self):
        """Patch _get_ec2_credentials with a fixed keypair."""
        return unittest.mock.patch(
            "swift_browser_ui.ui.api._get_ec2_credentials",
            unittest.mock.AsyncMock(
                return_value={"access": "test-access", "secret": "test-secret"}
            ),
        )

    def _session_patch(self, s3_client):
        """Patch aioboto3.Session to yield the given s3 client from ``client``.

        Returns (patch, session_mock). The client context manager mirrors
        the style used by ``_aws_list_buckets_mocks``.
        """
        ctx = unittest.mock.MagicMock()
        ctx.__aenter__ = unittest.mock.AsyncMock(return_value=s3_client)
        ctx.__aexit__ = unittest.mock.AsyncMock(return_value=False)
        session = unittest.mock.MagicMock()
        session.client.return_value = ctx
        patch = unittest.mock.patch(
            "swift_browser_ui.ui.api.aioboto3.Session", return_value=session
        )
        return patch, session

    def _set_s3_endpoint(self):
        """Populate the S3 endpoint settings used by the client factory."""
        self.setd_mock["s3api_endpoint"] = "https://test-s3-endpoint"
        self.setd_mock["check_certificate"] = False

    # -- existing tests ------------------------------------------------

    async def test_get_os_user(self):
        """Test session Openstack username fetch."""
        with self.p_get_sess, self.p_json_resp:
            await swift_browser_ui.ui.api.get_os_user(self.mock_request)
        self.aiohttp_json_response_mock.assert_called_once_with("testuser")

    async def test_os_list_projects(self):
        """Test Openstack available project scope fetch."""
        with self.p_get_sess, self.p_json_resp:
            await swift_browser_ui.ui.api.os_list_projects(
                self.mock_request,
            )
        self.aiohttp_json_response_mock.assert_called_once_with(
            [
                {
                    "id": "test-id-0",
                    "title": "",
                    "name": "test-name-0",
                    "tainted": False,
                },
                {
                    "id": "test-id-1",
                    "title": "",
                    "name": "test-name-1",
                    "tainted": False,
                },
            ]
        )

    async def test_os_list_projects_ldap_failure_degrades_to_empty_titles(self):
        """A failing LDAP lookup must degrade to empty titles, not a 500."""
        p_ldap = unittest.mock.patch(
            "swift_browser_ui.ui.api.ldap_get_project_titles",
            unittest.mock.AsyncMock(side_effect=Exception("ldap down")),
        )
        with self.p_get_sess, self.p_json_resp, p_ldap:
            await swift_browser_ui.ui.api.os_list_projects(self.mock_request)
        self.aiohttp_json_response_mock.assert_called_once_with(
            [
                {
                    "id": "test-id-0",
                    "title": "",
                    "name": "test-name-0",
                    "tainted": False,
                },
                {
                    "id": "test-id-1",
                    "title": "",
                    "name": "test-name-1",
                    "tainted": False,
                },
            ]
        )

    def _aws_list_buckets_mocks(self, error_response):
        """Build mocks for aws_list_buckets with a failing S3 client."""
        self.setd_mock["s3api_endpoint"] = "https://test-s3-endpoint"
        self.setd_mock["check_certificate"] = False

        mock_creds = unittest.mock.AsyncMock(
            return_value={"access": "test-access", "secret": "test-secret"}
        )
        p_creds = unittest.mock.patch(
            "swift_browser_ui.ui.api._get_ec2_credentials", mock_creds
        )

        mock_s3_client = unittest.mock.AsyncMock()
        mock_s3_client.list_buckets.side_effect = botocore.exceptions.ClientError(
            error_response,
            "ListBuckets",
        )
        mock_client_ctx = unittest.mock.MagicMock()
        mock_client_ctx.__aenter__ = unittest.mock.AsyncMock(return_value=mock_s3_client)
        mock_client_ctx.__aexit__ = unittest.mock.AsyncMock(return_value=False)
        mock_session = unittest.mock.MagicMock()
        mock_session.client.return_value = mock_client_ctx
        p_session = unittest.mock.patch(
            "swift_browser_ui.ui.api.aioboto3.Session", return_value=mock_session
        )
        return p_creds, p_session

    async def test_aws_list_buckets_inaccessible_project_maps_to_401(self):
        """Suspended/inaccessible project errors must map to 401, not 500.

        Ceph RGW rejects a suspended tenant with a symbolic error code
        (e.g. AccessDenied or UserSuspended) and HTTP 403 — never the
        literal string "401".
        """
        for code, status in [
            ("AccessDenied", 403),
            ("UserSuspended", 403),
            ("InvalidAccessKeyId", 403),
            ("SignatureDoesNotMatch", 403),
        ]:
            p_creds, p_session = self._aws_list_buckets_mocks(
                {
                    "Error": {"Code": code, "Message": code},
                    "ResponseMetadata": {"HTTPStatusCode": status},
                }
            )
            with self.p_get_sess, self.patch_setd, p_creds, p_session:
                with self.assertRaises(
                    aiohttp.web.HTTPUnauthorized,
                    msg=f"error code {code} should map to 401",
                ):
                    await swift_browser_ui.ui.api.aws_list_buckets(self.mock_request)

    async def test_aws_list_buckets_unknown_error_maps_to_500(self):
        """Unrelated S3 errors should still map to 500."""
        p_creds, p_session = self._aws_list_buckets_mocks(
            {
                "Error": {"Code": "SlowDown", "Message": "Please slow down"},
                "ResponseMetadata": {"HTTPStatusCode": 503},
            }
        )
        with self.p_get_sess, self.patch_setd, p_creds, p_session:
            with self.assertRaises(aiohttp.web.HTTPInternalServerError):
                await swift_browser_ui.ui.api.aws_list_buckets(self.mock_request)

    # -- aws_list_buckets happy path -----------------------------------

    async def test_aws_list_buckets_happy_path(self):
        """A normal listing returns the page with ISO-formatted dates.

        The handler forwards MaxBuckets/ContinuationToken to S3 and
        rewrites each bucket's CreationDate to an ISO 8601 string while
        preserving all other page keys (e.g. the ContinuationToken).
        """
        self._set_s3_endpoint()
        created = datetime.datetime(2026, 1, 2, 3, 4, 5)
        s3_client = unittest.mock.AsyncMock()
        s3_client.list_buckets.return_value = {
            "Buckets": [
                {"Name": "bucket-a", "CreationDate": created},
                {"Name": "bucket-b", "CreationDate": created},
            ],
            "ContinuationToken": "next-page",
        }
        p_session, _ = self._session_patch(s3_client)
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with self.p_json_resp:
                await swift_browser_ui.ui.api.aws_list_buckets(self.mock_request)

        s3_client.list_buckets.assert_awaited_once_with(
            MaxBuckets=1000,
            ContinuationToken="",
        )
        self.aiohttp_json_response_mock.assert_called_once_with(
            {
                "Buckets": [
                    {"Name": "bucket-a", "CreationDate": created.isoformat()},
                    {"Name": "bucket-b", "CreationDate": created.isoformat()},
                ],
                "ContinuationToken": "next-page",
            }
        )

    # -- aws_create_bucket ---------------------------------------------

    async def test_aws_create_bucket_success(self):
        """Success path creates the bucket then configures CORS, 204s."""
        self.mock_request.match_info["bucket"] = "test-bucket"
        self._set_s3_endpoint()
        s3_client = unittest.mock.AsyncMock()
        p_session, _ = self._session_patch(s3_client)
        p_cors = unittest.mock.patch(
            "swift_browser_ui.ui.api._update_bucket_cors",
            unittest.mock.AsyncMock(),
        )
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with p_cors as cors_mock:
                ret = await swift_browser_ui.ui.api.aws_create_bucket(self.mock_request)

        s3_client.create_bucket.assert_awaited_once_with(Bucket="test-bucket")
        cors_mock.assert_awaited_once()
        # CORS is applied to the bucket that was just created.
        self.assertEqual(cors_mock.await_args.args[2], "test-bucket")
        self.assertEqual(ret.status, 204)

    async def test_aws_create_bucket_conflict(self):
        """A duplicate bucket maps to HTTPConflict.

        RGW/S3 report this as the symbolic code "BucketAlreadyOwnedByYou"
        (HTTP 409) — a string, never the literal int 409.
        """
        self.mock_request.match_info["bucket"] = "test-bucket"
        self._set_s3_endpoint()
        s3_client = unittest.mock.AsyncMock()
        s3_client.create_bucket.side_effect = botocore.exceptions.ClientError(
            {
                "Error": {"Code": "BucketAlreadyOwnedByYou", "Message": "exists"},
                "ResponseMetadata": {"HTTPStatusCode": 409},
            },
            "CreateBucket",
        )
        p_session, _ = self._session_patch(s3_client)
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with self.assertRaises(aiohttp.web.HTTPConflict):
                await swift_browser_ui.ui.api.aws_create_bucket(self.mock_request)

    async def test_aws_create_bucket_suspended_maps_to_401(self):
        """A suspended/inaccessible project (AccessDenied / HTTP 403) maps to 401."""
        self.mock_request.match_info["bucket"] = "test-bucket"
        self._set_s3_endpoint()
        s3_client = unittest.mock.AsyncMock()
        s3_client.create_bucket.side_effect = botocore.exceptions.ClientError(
            {
                "Error": {"Code": "AccessDenied", "Message": "denied"},
                "ResponseMetadata": {"HTTPStatusCode": 403},
            },
            "CreateBucket",
        )
        p_session, _ = self._session_patch(s3_client)
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with self.assertRaises(aiohttp.web.HTTPUnauthorized):
                await swift_browser_ui.ui.api.aws_create_bucket(self.mock_request)

    # -- CORS ----------------------------------------------------------

    def _cors_expected_rule(self, origin):
        """The CORS rule the backend appends for the configured UI origin."""
        return {
            "AllowedHeaders": ["*"],
            "AllowedMethods": ["PUT", "GET", "DELETE", "POST", "HEAD"],
            "AllowedOrigins": [origin, f"{origin}/"],
            "ExposeHeaders": ["*"],
            "MaxAgeSeconds": 3600,
        }

    async def test_update_bucket_cors_creates_from_scratch(self):
        """With no existing CORS, the exact UI rule is written verbatim."""
        origin = "https://app.example"
        self._set_s3_endpoint()
        self.setd_mock["web_app_cors_origin"] = origin
        s3_client = unittest.mock.AsyncMock()
        s3_client.get_bucket_cors.side_effect = botocore.exceptions.ClientError(
            {"Error": {"Code": "NoSuchCORSConfiguration", "Message": "none"}},
            "GetBucketCors",
        )
        _, session = self._session_patch(s3_client)
        with self.patch_setd:
            await swift_browser_ui.ui.api._update_bucket_cors(
                unittest.mock.MagicMock(), session, "target-bucket"
            )

        s3_client.put_bucket_cors.assert_awaited_once_with(
            Bucket="target-bucket",
            CORSConfiguration={"CORSRules": [self._cors_expected_rule(origin)]},
        )

    async def test_update_bucket_cors_idempotent(self):
        """When the UI origin is already allowed, no PUT is issued."""
        origin = "https://app.example"
        self._set_s3_endpoint()
        self.setd_mock["web_app_cors_origin"] = origin
        s3_client = unittest.mock.AsyncMock()
        s3_client.get_bucket_cors.return_value = {
            "CORSRules": [{"AllowedOrigins": [origin], "AllowedMethods": ["GET"]}]
        }
        _, session = self._session_patch(s3_client)
        with self.patch_setd:
            await swift_browser_ui.ui.api._update_bucket_cors(
                unittest.mock.MagicMock(), session, "target-bucket"
            )

        s3_client.put_bucket_cors.assert_not_called()

    async def test_update_bucket_cors_appends_to_existing(self):
        """An unrelated existing rule is preserved and the UI rule appended."""
        origin = "https://app.example"
        self._set_s3_endpoint()
        self.setd_mock["web_app_cors_origin"] = origin
        existing = {
            "AllowedOrigins": ["https://other.example"],
            "AllowedMethods": ["GET"],
        }
        s3_client = unittest.mock.AsyncMock()
        s3_client.get_bucket_cors.return_value = {"CORSRules": [existing]}
        _, session = self._session_patch(s3_client)
        with self.patch_setd:
            await swift_browser_ui.ui.api._update_bucket_cors(
                unittest.mock.MagicMock(), session, "target-bucket"
            )

        s3_client.put_bucket_cors.assert_awaited_once_with(
            Bucket="target-bucket",
            CORSConfiguration={"CORSRules": [existing, self._cors_expected_rule(origin)]},
        )

    async def test_aws_update_bucket_cors_returns_204(self):
        """The route handler delegates to _update_bucket_cors and 204s."""
        self.mock_request.match_info["bucket"] = "test-bucket"
        self._set_s3_endpoint()
        p_session, session = self._session_patch(unittest.mock.AsyncMock())
        p_cors = unittest.mock.patch(
            "swift_browser_ui.ui.api._update_bucket_cors",
            unittest.mock.AsyncMock(),
        )
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with p_cors as cors_mock:
                ret = await swift_browser_ui.ui.api.aws_update_bucket_cors(
                    self.mock_request
                )
        cors_mock.assert_awaited_once_with(
            self.mock_request.app["Log"], session, "test-bucket"
        )
        self.assertEqual(ret.status, 204)

    async def test_aws_bulk_update_bucket_cors_explicit_list(self):
        """A ';'-separated bucket list updates each bucket then 204s."""
        self.mock_request.query = {"buckets": "bucket-a;bucket-b"}
        self._set_s3_endpoint()
        p_session, session = self._session_patch(unittest.mock.AsyncMock())
        p_cors = unittest.mock.patch(
            "swift_browser_ui.ui.api._update_bucket_cors",
            unittest.mock.AsyncMock(),
        )
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with p_cors as cors_mock:
                ret = await swift_browser_ui.ui.api.aws_bulk_update_bucket_cors(
                    self.mock_request
                )
        applied = [call.args[2] for call in cors_mock.await_args_list]
        self.assertEqual(applied, ["bucket-a", "bucket-b"])
        self.assertEqual(ret.status, 204)

    async def test_aws_bulk_update_bucket_cors_pages_when_no_list(self):
        """With no ?buckets param, it pages list_buckets and CORS-updates each."""
        self.mock_request.query = {}
        self._set_s3_endpoint()
        s3_client = unittest.mock.AsyncMock()
        s3_client.list_buckets.return_value = {
            "Buckets": [{"Name": "paged-a"}, {"Name": "paged-b"}],
        }
        p_session, _ = self._session_patch(s3_client)
        p_cors = unittest.mock.patch(
            "swift_browser_ui.ui.api._update_bucket_cors",
            unittest.mock.AsyncMock(),
        )
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with p_cors as cors_mock:
                ret = await swift_browser_ui.ui.api.aws_bulk_update_bucket_cors(
                    self.mock_request
                )
        applied = [call.args[2] for call in cors_mock.await_args_list]
        self.assertEqual(applied, ["paged-a", "paged-b"])
        self.assertEqual(ret.status, 204)

    # -- EC2 credentials -----------------------------------------------

    async def test_get_ec2_credentials_cached(self):
        """Cached credentials are returned without any keystone call."""
        cached = {"access": "cached-a", "secret": "cached-s"}
        self.session_return["projects"]["test-id-0"]["ec2"] = cached
        self.mock_client.get.reset_mock()
        self.mock_client.post.reset_mock()
        got = await swift_browser_ui.ui.api._get_ec2_credentials(
            self.session_return, self.mock_client, "test-id-0"
        )
        self.assertEqual(got, cached)
        self.mock_client.get.assert_not_called()
        self.mock_client.post.assert_not_called()

    async def test_get_ec2_credentials_existing_from_keystone(self):
        """An existing keystone credential for the tenant is reused."""
        self.session_return["uid"] = "test-uid"
        existing = {
            "access": "ea",
            "secret": "es",
            "tenant_id": "test-id-0",
        }
        self.mock_client_response.json = unittest.mock.AsyncMock(
            return_value={
                "credentials": [
                    {"access": "other", "secret": "x", "tenant_id": "other-tenant"},
                    existing,
                ]
            }
        )
        with self.patch_setd:
            got = await swift_browser_ui.ui.api._get_ec2_credentials(
                self.session_return, self.mock_client, "test-id-0"
            )
        self.assertEqual(got, existing)

    async def test_get_ec2_credentials_creates_new(self):
        """With no matching credential, a new one is created and cached."""
        self.session_return["uid"] = "test-uid"
        get_resp = types.SimpleNamespace(
            json=unittest.mock.AsyncMock(return_value={"credentials": []})
        )
        new_cred = {"access": "new-a", "secret": "new-s", "tenant_id": "test-id-0"}
        post_resp = types.SimpleNamespace(
            json=unittest.mock.AsyncMock(return_value={"credential": new_cred})
        )
        client = types.SimpleNamespace(
            get=unittest.mock.Mock(return_value=self.MockHandler(get_resp)),
            post=unittest.mock.Mock(return_value=self.MockHandler(post_resp)),
        )
        with self.patch_setd:
            got = await swift_browser_ui.ui.api._get_ec2_credentials(
                self.session_return, client, "test-id-0"
            )
        self.assertEqual(got, new_cred)
        # New credential is cached back into the session.
        self.assertEqual(self.session_return["projects"]["test-id-0"]["ec2"], new_cred)

    async def test_keystone_gen_ec2_serves_credentials(self):
        """keystone_gen_ec2 serves whatever _get_ec2_credentials returns."""
        creds = {"access": "ka", "secret": "ks"}
        p_creds = unittest.mock.patch(
            "swift_browser_ui.ui.api._get_ec2_credentials",
            unittest.mock.AsyncMock(return_value=creds),
        )
        with self.p_get_sess, p_creds, self.p_json_resp:
            await swift_browser_ui.ui.api.keystone_gen_ec2(self.mock_request)
        self.aiohttp_json_response_mock.assert_called_once_with(creds)

    # -- Swift public container toggle ---------------------------------

    async def test_swift_get_container_public_false(self):
        """No public tokens in the read ACL -> public False + address."""
        self.mock_client_response.status = 200
        self.mock_client_response.headers = {}
        with self.p_get_sess, self.p_json_resp:
            await swift_browser_ui.ui.api.swift_get_container_public(self.mock_request)
        self.aiohttp_json_response_mock.assert_called_once_with(
            {
                "public": False,
                "address": ("https://test-endpoint-0/v1/AUTH_test-id-0/test-container/"),
            }
        )

    async def test_swift_get_container_public_true(self):
        """Public tokens present -> public True."""
        self.mock_client_response.status = 200
        self.mock_client_response.headers = {"X-Container-Read": ".r:*,.rlistings"}
        with self.p_get_sess, self.p_json_resp:
            await swift_browser_ui.ui.api.swift_get_container_public(self.mock_request)
        self.aiohttp_json_response_mock.assert_called_once_with(
            {
                "public": True,
                "address": ("https://test-endpoint-0/v1/AUTH_test-id-0/test-container/"),
            }
        )

    async def test_swift_set_container_public_enable(self):
        """enabled=true writes the public tokens into X-Container-Read."""
        self.mock_request.query = {"enabled": "true"}
        self.mock_client_response.status = 204
        self.mock_client_response.headers = {}
        with self.p_get_sess:
            ret = await swift_browser_ui.ui.api.swift_set_container_public(
                self.mock_request
            )
        self.assertEqual(ret.status, 204)
        # Both the container and its _segments twin get the ACL update.
        self.assertEqual(self.mock_client.post.call_count, 2)
        posted = self.mock_client.post.call_args.kwargs["headers"]
        self.assertEqual(posted["X-Container-Read"], ".r:*,.rlistings")
        self.assertEqual(posted["X-Auth-Token"], "test-token-0")

    async def test_swift_set_container_public_disable(self):
        """enabled=false strips the public tokens from X-Container-Read."""
        self.mock_request.query = {"enabled": "false"}
        self.mock_client_response.status = 204
        self.mock_client_response.headers = {"X-Container-Read": ".r:*,.rlistings"}
        with self.p_get_sess:
            ret = await swift_browser_ui.ui.api.swift_set_container_public(
                self.mock_request
            )
        self.assertEqual(ret.status, 204)
        posted = self.mock_client.post.call_args.kwargs["headers"]
        self.assertEqual(posted["X-Container-Read"], "")

    async def test_swift_set_container_public_invalid_flag(self):
        """A missing/invalid ?enabled flag is a 400."""
        self.mock_request.query = {}
        with self.p_get_sess:
            with self.assertRaises(aiohttp.web.HTTPBadRequest):
                await swift_browser_ui.ui.api.swift_set_container_public(
                    self.mock_request
                )

    # -- object preview ------------------------------------------------

    async def test_aws_preview_object_not_found(self):
        """A NoSuchKey error from get_object maps to 404."""
        self.mock_request.match_info["bucket"] = "test-bucket"
        self._set_s3_endpoint()
        s3_client = unittest.mock.AsyncMock()
        s3_client.get_object.side_effect = botocore.exceptions.ClientError(
            {
                "Error": {"Code": "NoSuchKey", "Message": "missing"},
                "ResponseMetadata": {"HTTPStatusCode": 404},
            },
            "GetObject",
        )
        p_session, _ = self._session_patch(s3_client)
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with self.assertRaises(aiohttp.web.HTTPNotFound):
                await swift_browser_ui.ui.api.aws_preview_object(self.mock_request)

    async def test_aws_preview_object_streams_inline(self):
        """A successful preview sets inline headers and streams the body."""
        self.mock_request.match_info["bucket"] = "test-bucket"
        self._set_s3_endpoint()
        body = types.SimpleNamespace(
            read=unittest.mock.AsyncMock(side_effect=[b"exampleread", b""])
        )
        s3_client = unittest.mock.AsyncMock()
        s3_client.get_object.return_value = {
            "ContentType": "text/plain",
            "ContentLength": 11,
            "Body": body,
        }
        p_session, _ = self._session_patch(s3_client)
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with self.p_sresp:
                resp = await swift_browser_ui.ui.api.aws_preview_object(self.mock_request)
        self.assertEqual(resp.headers["Content-Type"], "text/plain; charset=utf-8")
        self.assertEqual(
            resp.headers["Content-Disposition"], 'inline; filename="test-object"'
        )
        self.assertEqual(resp.headers["Content-Length"], "11")
        self.mock_response_prepare.assert_awaited_once()
        self.mock_response_write.assert_awaited_once_with(b"exampleread")
        self.mock_response_write_eof.assert_awaited_once()

    # -- replication ---------------------------------------------------

    async def test_replicate_bucket_starts_replication(self):
        """replicate_bucket creates the destination + CORS and returns 202."""
        self.mock_request.match_info["bucket"] = "dest-bucket"
        self.mock_request.query = {
            "from_bucket": "source-bucket",
            "from_project": "source-project",
        }
        self._set_s3_endpoint()
        p_session, session = self._session_patch(unittest.mock.AsyncMock())

        replicator = unittest.mock.MagicMock()
        replicator.create_destination_bucket = unittest.mock.AsyncMock()
        replicator.replicate_objects = unittest.mock.AsyncMock()
        p_replicator = unittest.mock.patch(
            "swift_browser_ui.ui.api.ObjectReplicator",
            return_value=replicator,
        )
        p_cors = unittest.mock.patch(
            "swift_browser_ui.ui.api._update_bucket_cors",
            unittest.mock.AsyncMock(),
        )
        with self.p_get_sess, self.patch_setd, self._creds_patch(), p_session:
            with p_replicator, p_cors as cors_mock:
                ret = await swift_browser_ui.ui.api.replicate_bucket(self.mock_request)
                # Let the background replication task run to completion.
                await __import__("asyncio").sleep(0)

        self.assertEqual(ret.status, 202)
        replicator.create_destination_bucket.assert_awaited_once()
        cors_mock.assert_awaited_once_with(
            self.mock_request.app["Log"], session, "dest-bucket"
        )
        replicator.replicate_objects.assert_awaited_once()
