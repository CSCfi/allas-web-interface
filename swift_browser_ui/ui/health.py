"""Health check endpoint."""

import os
import time
import typing

import aiohttp.web
from aiohttp.client_exceptions import ServerDisconnectedError
from redis import ConnectionError
from redis.asyncio.sentinel import Sentinel

import swift_browser_ui.common.signature
from swift_browser_ui.ui._convenience import get_redis_client
from swift_browser_ui.ui.settings import setd


def _set_error_status(
    request: aiohttp.web.Request,
    services: typing.Dict[str, typing.Any],
    service: str,
) -> None:
    request.app["Log"].debug(f"Poll {service} failed")
    services[service] = {"status": "Error"}


async def get_x_account_sharing(
    services: typing.Dict[str, typing.Any],
    request: aiohttp.web.Request,
    web_client: aiohttp.ClientSession,
    api_params: dict,
    performance: typing.Dict[str, typing.Any],
) -> None:
    """Poll swift-x-account-sharing API."""
    try:
        if setd["sharing_internal_endpoint"]:
            start = time.time()
            async with web_client.get(
                str(setd["sharing_internal_endpoint"]) + "/health", params=api_params
            ) as resp:
                request.app["Log"].debug(resp)
                if resp.status != 200:
                    services["swift-x-account-sharing"] = {
                        "status": "Down",
                    }
                else:
                    sharing_status = await resp.json()
                    services["swift-x-account-sharing"] = sharing_status
            performance["swift-x-account-sharing"] = {"time": time.time() - start}
        else:
            services["swift-x-account-sharing"] = {"status": "Nonexistent"}
    except ServerDisconnectedError:
        _set_error_status(request, services, "swift-x-account-sharing")
    except Exception as e:
        request.app["Log"].info(f"Health failed for reason: {e}")
        _set_error_status(request, services, "swift-x-account-sharing")


async def get_upload_runner(
    services: typing.Dict[str, typing.Any],
    request: aiohttp.web.Request,
    web_client: aiohttp.ClientSession,
    api_params: dict,
    performance: typing.Dict[str, typing.Any],
) -> None:
    """Poll swiftui-upload-runner API."""
    try:
        if setd["upload_internal_endpoint"]:
            start = time.time()
            async with web_client.get(
                str(setd["upload_internal_endpoint"]) + "/health", params=api_params
            ) as resp:
                request.app["Log"].debug(resp)
                if resp.status != 200:
                    services["swiftui-upload-runner"] = {"status": "Down"}
                    end = time.time() - start
                    performance["swiftui-upload-runner"] = {"time": end}
                else:
                    status = await resp.json()
                    services["swiftui-upload-runner"] = status["upload-runner"]
                    performance["swiftui-upload-runner"] = {
                        "time": status["start-time"] - start
                    }
        else:
            services["swiftui-upload-runner"] = {"status": "Nonexistent"}
    except ServerDisconnectedError:
        _set_error_status(request, services, "swiftui-upload-runner")
    except Exception as e:
        request.app["Log"].info(f"Health failed for reason: {e}")
        _set_error_status(request, services, "swiftui-upload-runner")


async def get_redis(
    services: typing.Dict[str, typing.Any],
    request: aiohttp.web.Request,
    performance: typing.Dict[str, typing.Any],
) -> None:
    """Poll Redis service."""
    try:
        start = time.time()
        redis_client = await get_redis_client()
        await redis_client.ping()
        services["redis"] = {"status": "Ok"}
        performance["redis"] = {"time": time.time() - start}
        await redis_client.close()
    except ConnectionError:
        services["redis"] = {"status": "Down"}
        performance["redis"] = {"time": time.time() - start}
    except Exception as e:
        request.app["Log"].info(f"Health failed for reason: {e}")
        _set_error_status(request, services, "redis")


async def get_redis_master(
    services: typing.Dict[str, typing.Any], request: aiohttp.web.Request
) -> None:
    """Add current Redis master (via Sentinel) or role (via direct) to health."""
    try:
        sentinel_url = os.environ.get("SWIFT_UI_REDIS_SENTINEL_HOST", "")
        sentinel_port = os.environ.get("SWIFT_UI_REDIS_SENTINEL_PORT", "")
        sentinel_master = os.environ.get("SWIFT_UI_REDIS_SENTINEL_MASTER", "")
        sentinel_password = os.environ.get("SWIFT_UI_REDIS_SENTINEL_PASSWORD", "")

        if sentinel_url and sentinel_port:

            kwargs = {}
            if sentinel_password:
                kwargs["password"] = sentinel_password

            s = Sentinel(
                [(str(sentinel_url), int(sentinel_port))], sentinel_kwargs=kwargs
            )
            host, port = await s.discover_master(sentinel_master)
            pod_name = host.split(".", 1)[0] if "." in host else host
            services["redis-sentinel"] = {
                "status": "Ok",
                "role": "master",
                "pod": pod_name,
            }
        else:
            services["redis-sentinel"] = {"status": "Unknown"}
    except Exception as e:
        request.app["Log"].info(f"Redis master check failed: {e}")
        services["redis-sentinel"] = {"status": "Error"}


async def get_redis_connected_info(services, request):
    """Collect Redis connected node stats for the health output."""
    try:
        client = await get_redis_client()
        info = await client.info(section="replication")
        await client.close()
        services["connected-redis-node"] = {
            "status": "Ok",
            "role": info.get("role"),
            "connected_slaves": info.get("connected_slaves"),
        }
    except Exception as e:
        request.app["Log"].info(f"Redis INFO replication failed: {e}")
        services["connected-redis-node"] = {"status": "Error"}


async def handle_health_check(request: aiohttp.web.Request) -> aiohttp.web.Response:
    """Handle a service health check."""
    # Pull all health endpoint information
    web_client = request.app["api_client"]

    status: typing.Dict[str, typing.Union[str, typing.Dict]] = {
        "status": "Ok",
    }

    services: typing.Dict[str, typing.Any] = {}
    performance: typing.Dict[str, typing.Any] = {}

    signature = swift_browser_ui.common.signature.sign_api_request("/health")
    api_params = {
        "signature": signature["signature"],
        "valid": signature["valid"],
    }

    await get_x_account_sharing(services, request, web_client, api_params, performance)

    await get_upload_runner(services, request, web_client, api_params, performance)

    await get_redis(services, request, performance)

    await get_redis_master(services, request)

    await get_redis_connected_info(services, request)

    status["services"] = services
    status["performance"] = performance

    for service in services.values():
        if service["status"] in ["Down", "Error"]:
            status["status"] = "Partially down"
            break
        if service["status"] == "Degraded":
            status["status"] = "Degraded"

    for perf in performance.values():
        if perf["time"] > 1000 and not status["status"] == "Down":
            status["status"] = "Degraded (high load)"

    return aiohttp.web.json_response(status)
