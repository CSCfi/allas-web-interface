"""Module for handling queries for a valid Sharing/Request API signature."""

import logging

import aiohttp.web
import aiohttp_session

import swift_browser_ui.ui._convenience

from .settings import setd

LOGGER = logging.getLogger("signature")


async def handle_signature_request(
    request: aiohttp.web.Request,
) -> aiohttp.web.Response:
    """Handle call for an API call signature."""
    session = await aiohttp_session.get_session(request)
    if not session["projects"]:
        raise aiohttp.web.HTTPUnauthorized(reason="No valid project for session.")
    try:
        valid_for = int(request.match_info["valid"])
        path_to_sign = request.query["path"]
    except KeyError:
        raise aiohttp.web.HTTPBadRequest(
            reason="Signable path missing from query string."
        )

    return aiohttp.web.json_response(
        await swift_browser_ui.ui._convenience.sign(valid_for, path_to_sign)
    )

    return resp
