from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path

from .server import DEFAULT_HOST, DEFAULT_PORT, DEFAULT_STATE_FILE, run_relay_server


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="codex-relay-py")
    parser.add_argument("command", nargs="?", default="start", choices=["start", "status"])
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--state-file", default=None)
    return parser


def resolve_settings(args: argparse.Namespace) -> tuple[str, int, Path]:
    host = args.host or os.environ.get("CODEX_BROWSER_RELAY_HOST") or DEFAULT_HOST
    port = args.port or int(os.environ.get("CODEX_BROWSER_RELAY_PORT", DEFAULT_PORT))
    state_file = Path(args.state_file or os.environ.get("CODEX_BROWSER_RELAY_STATE_FILE") or DEFAULT_STATE_FILE).resolve()
    return host, port, state_file


async def print_status(state_file: Path) -> None:
    raw = state_file.read_text(encoding="utf-8")
    print(json.dumps(json.loads(raw), indent=2))


def main() -> None:
    args = build_parser().parse_args()
    host, port, state_file = resolve_settings(args)

    if args.command == "status":
        asyncio.run(print_status(state_file))
        return

    asyncio.run(run_relay_server(host=host, port=port, state_file=state_file))


if __name__ == "__main__":
    main()
