---
'@moonshot-ai/kimi-code': minor
---

Remote Control is disabled. `kimi rc`, `kimi web --rc` and the `/rc` slash
command are gone, and `POST /api/v1/remote-control` refuses to enable the
tunnel. The local web UI is unaffected: run `kimi web`.

The tunnel forwarded public-internet traffic into the local server, which has
the terminal, file and approval APIs enabled, and authenticated to the relay
with the long-lived Kimi refresh token. There is no environment variable to
turn it back on.
