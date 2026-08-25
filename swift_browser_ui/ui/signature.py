"""Module for handling queries for a valid Sharing/Request API signature."""

import logging

import aiohttp.web
import aiohttp_session

import swift_browser_ui.ui._convenience

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

    # Validate that the signed path is accessing content allowed in context
    # by checking the signed path contains one of the allowed projects
    matching_project = False
    for project in session["projects"].keys():
        if project in path_to_sign:
            matching_project = True

        # Also check against the project name
        if session["projects"][project]["name"] in path_to_sign:
            matching_project = True

    # Allow ids to be queried for any project
    if path_to_sign.startswith("/ids") and request.method == "GET":
        matching_project = True

    if matching_project:
        return aiohttp.web.json_response(
            await swift_browser_ui.ui._convenience.sign(valid_for, path_to_sign)
        )
    else:
        # Raise in case user tries accessing project beyond verified scope
        LOGGER.info(f"Could not find a valid project in {path_to_sign}")
        LOGGER.info(f"Valid projects were {list(session['projects'].keys())}")
        raise aiohttp.web.HTTPForbidden(
            reason="Path contains a project not accessible in login scope."
        )
