# Switching the installed relay to Python

After running the main repository installer, switch the installed relay launcher with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\relay-service-py\scripts\install-python-relay.ps1
```

This updates:

`%USERPROFILE%\.codex\codex-browser-relay\relay-service\run-relay-service.cmd`

So the existing hidden VBS launcher and autostart continue to work, but the backend process becomes:

`python -m relay start --host 127.0.0.1 --port 18793`
