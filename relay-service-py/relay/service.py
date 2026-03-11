from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path

import servicemanager
import win32event
import win32service
import win32serviceutil

from relay.server import DEFAULT_HOST, DEFAULT_PORT, run_relay_server


def load_service_config() -> dict:
    config_path = Path(__file__).resolve().parents[1] / "service-config.json"
    if not config_path.exists():
        return {}
    return json.loads(config_path.read_text(encoding="utf-8"))


class CodexBrowserRelayPyService(win32serviceutil.ServiceFramework):
    _svc_name_ = "CodexBrowserRelayPy"
    _svc_display_name_ = "Codex Browser Relay (Python)"
    _svc_description_ = "Runs the Python backend for Codex Browser Relay on 127.0.0.1:18793."

    def __init__(self, args):
        super().__init__(args)
        self.stop_event_handle = win32event.CreateEvent(None, 0, 0, None)
        self.stop_requested = threading.Event()

    def SvcStop(self):
        self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
        self.stop_requested.set()
        win32event.SetEvent(self.stop_event_handle)

    def SvcDoRun(self):
        config = load_service_config()
        host = config.get("host", DEFAULT_HOST)
        port = int(config.get("port", DEFAULT_PORT))
        state_file = Path(config.get("stateFile", str(Path(__file__).resolve().parents[2] / "relay-service" / "runtime" / "relay-state.json")))

        servicemanager.LogInfoMsg(f"{self._svc_name_} starting on {host}:{port}")
        try:
            asyncio.run(
                run_relay_server(
                    host=host,
                    port=port,
                    state_file=state_file,
                    stop_signal=self.stop_requested,
                )
            )
        except Exception as exc:  # noqa: BLE001
            servicemanager.LogErrorMsg(f"{self._svc_name_} failed: {exc}")
            raise
        servicemanager.LogInfoMsg(f"{self._svc_name_} stopped")


if __name__ == "__main__":
    win32serviceutil.HandleCommandLine(CodexBrowserRelayPyService)
