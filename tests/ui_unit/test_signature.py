"""Module for testing ``signature.py``."""

import types
import unittest

import aiohttp

from swift_browser_ui.ui.signature import handle_signature_request

import tests.common.mockups


class SignatureMiscTestClass(
    tests.common.mockups.APITestBase,
):
    """Class for testing the signature module misc handlers."""

    def setUp(self):
        """Set up relevant mocks."""
        super().setUp()
        self.sign_mock = unittest.mock.AsyncMock(
            return_value={
                "valid": 15000000,
                "signature": "test-signature",
            }
        )
        self.sign_patch = unittest.mock.patch(
            "swift_browser_ui.ui._convenience.sign", self.sign_mock
        )

        self.mock_request.match_info = {"valid": 600, "count": 60, "project": "test-id-0"}
        self.mock_request.method = "GET"
        self.mock_request.query = {
            "path": "/test-id-0/path",
            "count": "60",
        }

        self.get_tempurl_key_mock = unittest.mock.AsyncMock(return_value="test-key")
        self.get_tempurl_key_patch = unittest.mock.patch(
            "swift_browser_ui.ui._convenience.get_tempurl_key", self.get_tempurl_key_mock
        )

        self.mock_request_noval = types.SimpleNamespace(
            **{
                "query": {},
                "match_info": {},
            }
        )

        self.p_get_sess = unittest.mock.patch(
            "swift_browser_ui.ui.signature.aiohttp_session.get_session",
            self.aiohttp_session_get_session_mock,
        )

        self.mock_client_text = "Test token listing."

    async def test_handle_signature_request_correct(self):
        """Test signature request handler."""
        with self.p_get_sess, self.sign_patch:
            resp = await handle_signature_request(self.mock_request)
        self.assertIsInstance(resp, aiohttp.web.Response)

    async def test_handle_signature_request_fail_no_values(self):
        """Test signature request handler when failing on client error."""
        with self.assertRaises(aiohttp.web_exceptions.HTTPClientError):
            with self.p_get_sess, self.sign_patch:
                await handle_signature_request(self.mock_request_noval)

    async def test_handle_signature_mismatched_project(self):
        """Test signature request when project doesn't exist in session."""
        self.mock_request.query["path"] = "/cryptic/another-project"

        with self.assertRaises(aiohttp.web_exceptions.HTTPForbidden):
            with self.p_get_sess, self.sign_patch:
                await handle_signature_request(self.mock_request)

    async def test_handle_signature_for_ids_success(self):
        """Test signature request for fetching the id cache."""
        self.mock_request.query["path"] = "/ids/test-id-0"

        with self.p_get_sess, self.sign_patch:
            resp = await handle_signature_request(self.mock_request)
        self.assertIsInstance(resp, aiohttp.web.Response)

    async def test_handle_signature_for_ids_put_fail(self):
        """Test signature request for adding id to cache for other project."""
        self.mock_request.method = "PUT"
        self.mock_request.query["path"] = "/ids/another-project"

        with self.assertRaises(aiohttp.web_exceptions.HTTPForbidden):
            with self.p_get_sess, self.sign_patch:
                await handle_signature_request(self.mock_request)

    async def test_handle_signature_for_ids_put_success(self):
        """Test signature request for adding id to cache for own project."""
        self.mock_request.method = "PUT"
        self.mock_request.query["path"] = "/ids/test-id-0"

        with self.p_get_sess, self.sign_patch:
            resp = await handle_signature_request(self.mock_request)
        self.assertIsInstance(resp, aiohttp.web.Response)
