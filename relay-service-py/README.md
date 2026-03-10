# Codex Browser Relay Service (Python)

Python implementation of the local relay service for the Codex Browser Relay extension.

It keeps the same practical contract as the Node.js relay where possible:

- `HEAD /`
- `GET /extension/status`
- `GET /page/list`
- `POST /page/command`
- `GET/PUT /json/version`
- `GET/PUT /json/list`
- `GET/PUT /json/new`
- `GET/PUT /json/activate/{id}`
- `GET/PUT /json/close/{id}`
- WebSocket `/extension`
- WebSocket `/cdp`

## Install

```powershell
cd relay-service-py
python -m pip install -e .
```

## Run

```powershell
python -m relay start
```

Optional arguments:

```powershell
python -m relay start --host 127.0.0.1 --port 18793
python -m relay status
```
