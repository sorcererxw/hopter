# Deployment Notes

## Local-only mode

Default development mode:

```bash
bun install
bun run build:web
bun run start
```

Defaults:

- bind host: `127.0.0.1`
- port: `8787`
- access mode: `local_only`

## Long-running process

For a persistent local host process, run `bun run start` under:

- `tmux`
- `screen`
- `launchd`
- `systemd`
- or another supervised process manager

## Self-managed remote mode

Enable reverse-proxy-safe behavior with:

```bash
ORCHD_ACCESS_MODE=self_managed_remote
ORCHD_TRUST_PROXY=true
```

This turns on secure auth cookies and assumes the proxy is responsible for TLS.

Example reverse proxy responsibilities:

- terminate TLS
- forward `Host` and `X-Forwarded-*` headers
- protect the origin from direct public exposure when possible

## Recommended reverse proxy shape

```text
Internet
  -> HTTPS reverse proxy
    -> http://127.0.0.1:8787
```

`orchd` remains a single Bun process behind the proxy.
