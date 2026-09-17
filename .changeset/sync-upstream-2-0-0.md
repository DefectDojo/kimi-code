---
'@moonshot-ai/kimi-code': minor
---

Merge upstream 2.0.0. The fork's hardening carries forward unchanged: the
plugin marketplace stays host-pinned (now covering the new `.ai` region hosts
alongside `.com`), file tools still re-check paths against their symlink
target, telemetry stays opt-in, and Bash is still not blanket-approved in
auto mode.

Upstream's new dangerous-command guard is kept and strengthened: it is loaded
for non-interactive hosts too, where upstream skips it.
