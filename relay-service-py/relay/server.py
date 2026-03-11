from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from aiohttp import WSMsgType, web

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 18793
DEFAULT_STATE_FILE = Path.cwd() / "runtime" / "relay-state.json"

def log_line(message: str, extra: str = "") -> None:
    suffix = f" {extra}" if extra else ""
    print(f"[relay {__import__('datetime').datetime.utcnow().isoformat()}Z] {message}{suffix}", flush=True)


def is_loopback_host(host: str) -> bool:
    normalized = (host or "").strip().lower()
    return normalized in {"localhost", "127.0.0.1", "::1", "[::1]"}


def is_loopback_address(ip: str | None) -> bool:
    if not ip:
        return False
    return ip == "127.0.0.1" or ip.startswith("127.") or ip == "::1" or ip.startswith("::ffff:127.")


async def ensure_parent_dir(file_path: Path) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)


async def write_state_file(state_file: Path, payload: dict[str, Any]) -> None:
    await ensure_parent_dir(state_file)
    state_file.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def build_metadata(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, state_file: Path = DEFAULT_STATE_FILE) -> dict[str, Any]:
    base_url = f"http://{host}:{port}"
    return {
        "host": host,
        "port": port,
        "baseUrl": base_url,
        "cdpWsUrl": f"ws://{host}:{port}/cdp",
        "extensionWsUrl": f"ws://{host}:{port}/extension",
        "stateFile": str(state_file),
    }


def create_target_list(connected_targets: dict[str, dict[str, Any]], cdp_ws_url: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for target in connected_targets.values():
        info = target["targetInfo"]
        result.append(
            {
                "id": target["targetId"],
                "type": info.get("type", "page"),
                "title": info.get("title", ""),
                "description": info.get("title", ""),
                "url": info.get("url", ""),
                "webSocketDebuggerUrl": cdp_ws_url,
                "devtoolsFrontendUrl": f"/devtools/inspector.html?ws={cdp_ws_url.removeprefix('ws://')}",
            }
        )
    return result


@dataclass
class RelayState:
    metadata: dict[str, Any]
    extension_ws: web.WebSocketResponse | None = None
    cdp_clients: set[web.WebSocketResponse] = field(default_factory=set)
    connected_targets: dict[str, dict[str, Any]] = field(default_factory=dict)
    connected_pages: dict[str, dict[str, Any]] = field(default_factory=dict)
    pending_extension: dict[int, asyncio.Future] = field(default_factory=dict)
    next_extension_id: int = 1


def peer_ip(request: web.Request) -> str | None:
    peer = request.transport.get_extra_info("peername") if request.transport else None
    if not peer:
        return None
    if isinstance(peer, tuple):
        return peer[0]
    return None


@web.middleware
async def loopback_only_middleware(request: web.Request, handler):
    if not is_loopback_address(peer_ip(request)):
        raise web.HTTPForbidden(text="Forbidden")
    return await handler(request)


async def send_to_extension(state: RelayState, payload: dict[str, Any]) -> Any:
    ws = state.extension_ws
    if ws is None or ws.closed:
        raise RuntimeError("Codex Browser Relay extension is not connected")

    request_id = payload["id"]
    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    state.pending_extension[request_id] = future
    await ws.send_json(payload)

    try:
        return await asyncio.wait_for(future, timeout=30)
    finally:
        state.pending_extension.pop(request_id, None)


async def route_cdp_command(state: RelayState, command: dict[str, Any]) -> Any:
    method = command.get("method")
    if method == "Browser.getVersion":
        return {
            "protocolVersion": "1.3",
            "product": "Chrome/Codex-Extension-Relay-Py",
            "revision": "0",
            "userAgent": "Codex-Extension-Relay-Py",
            "jsVersion": "V8",
        }
    if method in {"Browser.setDownloadBehavior", "Target.setAutoAttach", "Target.setDiscoverTargets"}:
        return {}
    if method == "Target.getTargets":
        return {
            "targetInfos": [
                {**entry["targetInfo"], "attached": True}
                for entry in state.connected_targets.values()
            ]
        }
    if method == "Target.getTargetInfo":
        requested_target_id = (command.get("params") or {}).get("targetId")
        if requested_target_id:
            for target in state.connected_targets.values():
                if target["targetId"] == requested_target_id:
                    return {"targetInfo": target["targetInfo"]}
        session_id = command.get("sessionId")
        if session_id and session_id in state.connected_targets:
            return {"targetInfo": state.connected_targets[session_id]["targetInfo"]}
        first = next(iter(state.connected_targets.values()), None)
        return {"targetInfo": first["targetInfo"] if first else None}
    if method == "Target.attachToTarget":
        target_id = (command.get("params") or {}).get("targetId")
        if not target_id:
            raise RuntimeError("targetId required")
        for target in state.connected_targets.values():
            if target["targetId"] == target_id:
                return {"sessionId": target["sessionId"]}
        raise RuntimeError("target not found")

    state.next_extension_id += 1
    return await send_to_extension(
        state,
        {
            "id": state.next_extension_id,
            "method": "forwardCDPCommand",
            "params": {
                "method": method,
                "sessionId": command.get("sessionId"),
                "params": command.get("params"),
            },
        },
    )


def ensure_target_events_for_client(state: RelayState, ws: web.WebSocketResponse, mode: str) -> None:
    for target in state.connected_targets.values():
        if mode == "autoAttach":
            payload = {
                "method": "Target.attachedToTarget",
                "params": {
                    "sessionId": target["sessionId"],
                    "targetInfo": {**target["targetInfo"], "attached": True},
                    "waitingForDebugger": False,
                },
            }
        else:
            payload = {
                "method": "Target.targetCreated",
                "params": {
                    "targetInfo": {**target["targetInfo"], "attached": True},
                },
            }
        asyncio.create_task(ws.send_json(payload))


async def handle_root(request: web.Request) -> web.Response:
    if request.method == "HEAD":
        return web.Response(status=200)
    return web.Response(text="OK")


async def handle_extension_status(request: web.Request) -> web.Response:
    state: RelayState = request.app["relay_state"]
    return web.json_response({"connected": state.extension_ws is not None, "targets": len(state.connected_targets), "pages": len(state.connected_pages)})


async def handle_page_list(request: web.Request) -> web.Response:
    state: RelayState = request.app["relay_state"]
    return web.json_response(list(state.connected_pages.values()))


async def handle_page_command(request: web.Request) -> web.Response:
    state: RelayState = request.app["relay_state"]
    body = await request.json() if request.can_read_body else {}
    state.next_extension_id += 1
    result = await send_to_extension(
        state,
        {
            "id": state.next_extension_id,
            "method": "pageCommand",
            "params": dict(body),
        },
    )
    return web.json_response(result)


async def handle_json_version(request: web.Request) -> web.Response:
    state: RelayState = request.app["relay_state"]
    host = request.headers.get("Host", f"{state.metadata['host']}:{state.metadata['port']}")
    payload: dict[str, Any] = {"Browser": "Codex/extension-relay-py", "Protocol-Version": "1.3"}
    if state.extension_ws is not None:
        payload["webSocketDebuggerUrl"] = f"ws://{host}/cdp"
    return web.json_response(payload)


async def handle_json_list(request: web.Request) -> web.Response:
    state: RelayState = request.app["relay_state"]
    host = request.headers.get("Host", f"{state.metadata['host']}:{state.metadata['port']}")
    return web.json_response(create_target_list(state.connected_targets, f"ws://{host}/cdp"))


async def handle_json_activate(request: web.Request) -> web.Response:
    state: RelayState = request.app["relay_state"]
    target_id = request.match_info["target_id"]
    state.next_extension_id += 1
    asyncio.create_task(
        send_to_extension(
            state,
            {
                "id": state.next_extension_id,
                "method": "forwardCDPCommand",
                "params": {"method": "Target.activateTarget", "params": {"targetId": target_id}},
            },
        )
    )
    return web.Response(text="OK")


async def handle_json_close(request: web.Request) -> web.Response:
    state: RelayState = request.app["relay_state"]
    target_id = request.match_info["target_id"]
    state.next_extension_id += 1
    asyncio.create_task(
        send_to_extension(
            state,
            {
                "id": state.next_extension_id,
                "method": "forwardCDPCommand",
                "params": {"method": "Target.closeTarget", "params": {"targetId": target_id}},
            },
        )
    )
    return web.Response(text="OK")


async def handle_json_new(request: web.Request) -> web.Response:
    state: RelayState = request.app["relay_state"]
    url_to_open = request.query.get("url", "about:blank")
    state.next_extension_id += 1
    result = await send_to_extension(
        state,
        {
            "id": state.next_extension_id,
            "method": "forwardCDPCommand",
            "params": {"method": "Target.createTarget", "params": {"url": url_to_open}},
        },
    )
    target_id = result.get("targetId", "")
    target = next((entry for entry in state.connected_targets.values() if entry["targetId"] == target_id), None)
    host = request.headers.get("Host", f"{state.metadata['host']}:{state.metadata['port']}")
    if target:
        payload = {
            "id": target["targetId"],
            "type": target["targetInfo"].get("type", "page"),
            "title": target["targetInfo"].get("title", ""),
            "description": target["targetInfo"].get("title", ""),
            "url": target["targetInfo"].get("url", url_to_open),
            "webSocketDebuggerUrl": f"ws://{host}/cdp",
        }
    else:
        payload = {
            "id": target_id,
            "type": "page",
            "title": "",
            "description": "",
            "url": url_to_open,
            "webSocketDebuggerUrl": f"ws://{host}/cdp",
        }
    return web.json_response(payload)


async def ws_extension_handler(request: web.Request) -> web.WebSocketResponse:
    state: RelayState = request.app["relay_state"]
    origin = request.headers.get("Origin", "")
    if origin and not origin.startswith("chrome-extension://"):
        raise web.HTTPForbidden(text="Forbidden: invalid origin")
    if state.extension_ws is not None and not state.extension_ws.closed:
        raise web.HTTPConflict(text="Extension already connected")

    ws = web.WebSocketResponse()
    await ws.prepare(request)
    state.extension_ws = ws
    log_line("extension connected")

    async def ping_loop() -> None:
        try:
            while not ws.closed:
                await asyncio.sleep(5)
                if ws.closed:
                    break
                await ws.send_json({"method": "ping"})
        except Exception:  # noqa: BLE001
            return

    ping_task = asyncio.create_task(ping_loop())

    async for message in ws:
        if message.type is WSMsgType.TEXT:
            try:
                parsed = json.loads(message.data)
            except json.JSONDecodeError:
                continue

            if isinstance(parsed, dict) and isinstance(parsed.get("id"), int):
                pending = state.pending_extension.pop(parsed["id"], None)
                if pending and not pending.done():
                    if isinstance(parsed.get("error"), str) and parsed["error"].strip():
                        pending.set_exception(RuntimeError(parsed["error"]))
                    else:
                        pending.set_result(parsed.get("result"))
                continue

            if not isinstance(parsed, dict):
                continue
            if parsed.get("method") == "pong":
                continue
            if parsed.get("method") == "pageAttached":
                params = parsed.get("params") or {}
                if params.get("sessionId") and params.get("pageId"):
                    log_line("page attached", f"session={params['sessionId']} url={params.get('page', {}).get('url', '')}")
                    state.connected_pages[params["sessionId"]] = {
                        "sessionId": params["sessionId"],
                        "pageId": params["pageId"],
                        "tabId": params.get("tabId"),
                        "page": params.get("page") or {},
                    }
                continue
            if parsed.get("method") == "pageDetached":
                params = parsed.get("params") or {}
                session_id = params.get("sessionId")
                if session_id:
                    log_line("page detached", f"session={session_id}")
                    state.connected_pages.pop(session_id, None)
                continue
            if parsed.get("method") != "forwardCDPEvent":
                continue

            event = parsed.get("params") or {}
            method = event.get("method")
            params = event.get("params")
            session_id = event.get("sessionId")
            if not method:
                continue

            if method == "Target.attachedToTarget":
                attached = params or {}
                target_info = attached.get("targetInfo") or {}
                if target_info.get("type", "page") != "page":
                    continue
                if attached.get("sessionId") and target_info.get("targetId"):
                    state.connected_targets[attached["sessionId"]] = {
                        "sessionId": attached["sessionId"],
                        "targetId": target_info["targetId"],
                        "targetInfo": target_info,
                    }

            elif method == "Target.detachedFromTarget":
                detached = params or {}
                session = detached.get("sessionId")
                if session:
                    state.connected_targets.pop(session, None)

            elif method == "Target.targetInfoChanged":
                target_info = (params or {}).get("targetInfo") or {}
                target_id = target_info.get("targetId")
                if target_id and target_info.get("type", "page") == "page":
                    for session, target in list(state.connected_targets.items()):
                        if target["targetId"] != target_id:
                            continue
                        state.connected_targets[session] = {
                            **target,
                            "targetInfo": {**target["targetInfo"], **target_info},
                        }

            payload = {"method": method, "params": params, "sessionId": session_id}
            await asyncio.gather(
                *(client.send_json(payload) for client in state.cdp_clients if not client.closed),
                return_exceptions=True,
            )
        elif message.type is WSMsgType.ERROR:
            log_line("extension websocket error", str(ws.exception()))
            break

    log_line("extension disconnected", f"close_code={ws.close_code}")
    ping_task.cancel()
    state.extension_ws = None
    for future in state.pending_extension.values():
        if not future.done():
            future.set_exception(RuntimeError("extension disconnected"))
    state.pending_extension.clear()
    state.connected_targets.clear()
    state.connected_pages.clear()
    for client in list(state.cdp_clients):
        await client.close(code=1011, message=b"extension disconnected")
    state.cdp_clients.clear()
    return ws


async def ws_cdp_handler(request: web.Request) -> web.WebSocketResponse:
    state: RelayState = request.app["relay_state"]
    if state.extension_ws is None or state.extension_ws.closed:
        raise web.HTTPServiceUnavailable(text="Extension not connected")

    ws = web.WebSocketResponse()
    await ws.prepare(request)
    state.cdp_clients.add(ws)
    log_line("cdp client connected", f"count={len(state.cdp_clients)}")

    async for message in ws:
        if message.type is not WSMsgType.TEXT:
            continue
        try:
            command = json.loads(message.data)
        except json.JSONDecodeError:
            continue
        if not isinstance(command, dict) or not isinstance(command.get("id"), int) or not isinstance(command.get("method"), str):
            continue
        try:
            result = await route_cdp_command(state, command)

            if command["method"] == "Target.setAutoAttach" and not command.get("sessionId"):
                ensure_target_events_for_client(state, ws, "autoAttach")
            if command["method"] == "Target.setDiscoverTargets" and (command.get("params") or {}).get("discover") is True:
                ensure_target_events_for_client(state, ws, "discover")
            if command["method"] == "Target.attachToTarget":
                target_id = (command.get("params") or {}).get("targetId")
                if target_id:
                    target = next((entry for entry in state.connected_targets.values() if entry["targetId"] == target_id), None)
                    if target:
                        await ws.send_json(
                            {
                                "method": "Target.attachedToTarget",
                                "params": {
                                    "sessionId": target["sessionId"],
                                    "targetInfo": {**target["targetInfo"], "attached": True},
                                    "waitingForDebugger": False,
                                },
                            }
                        )

            await ws.send_json({"id": command["id"], "sessionId": command.get("sessionId"), "result": result})
        except Exception as exc:  # noqa: BLE001
            await ws.send_json(
                {
                    "id": command["id"],
                    "sessionId": command.get("sessionId"),
                    "error": {"message": str(exc)},
                }
            )

    state.cdp_clients.discard(ws)
    log_line("cdp client disconnected", f"count={len(state.cdp_clients)}")
    return ws


def create_app(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, state_file: Path = DEFAULT_STATE_FILE) -> web.Application:
    metadata = build_metadata(host=host, port=port, state_file=state_file)
    app = web.Application(client_max_size=1024 * 1024, middlewares=[loopback_only_middleware])
    app["relay_state"] = RelayState(metadata=metadata)

    app.router.add_route("HEAD", "/", handle_root)
    app.router.add_route("GET", "/", handle_root)
    app.router.add_get("/extension/status", handle_extension_status)
    app.router.add_get("/page/list", handle_page_list)
    app.router.add_post("/page/command", handle_page_command)
    app.router.add_get("/json/version", handle_json_version)
    app.router.add_put("/json/version", handle_json_version)
    app.router.add_get("/json/list", handle_json_list)
    app.router.add_put("/json/list", handle_json_list)
    app.router.add_get("/json", handle_json_list)
    app.router.add_put("/json", handle_json_list)
    app.router.add_get("/json/new", handle_json_new)
    app.router.add_put("/json/new", handle_json_new)
    app.router.add_get(r"/json/activate/{target_id:.+}", handle_json_activate)
    app.router.add_put(r"/json/activate/{target_id:.+}", handle_json_activate)
    app.router.add_get(r"/json/close/{target_id:.+}", handle_json_close)
    app.router.add_put(r"/json/close/{target_id:.+}", handle_json_close)
    app.router.add_get("/extension", ws_extension_handler)
    app.router.add_get("/cdp", ws_cdp_handler)

    return app


async def run_relay_server(host: str = DEFAULT_HOST, port: int = DEFAULT_PORT, state_file: Path = DEFAULT_STATE_FILE) -> None:
    if not is_loopback_host(host):
        raise RuntimeError(f"relay requires loopback host, got {host}")

    app = create_app(host=host, port=port, state_file=state_file)
    state: RelayState = app["relay_state"]
    await write_state_file(
        state_file,
        {
            **state.metadata,
            "startedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "modelTarget": "anthropic/claude-opus-4-6",
        },
    )

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, host=host, port=port)
    await site.start()

    print(f"Codex Browser Relay (Python) listening on {state.metadata['baseUrl']}")
    print(f"Extension WebSocket: {state.metadata['extensionWsUrl']}")
    print(f"CDP WebSocket: {state.metadata['cdpWsUrl']}")
    print(f"State file: {state.metadata['stateFile']}")

    stop_event = asyncio.Event()
    try:
        await stop_event.wait()
    except KeyboardInterrupt:
        pass
    finally:
        await runner.cleanup()
