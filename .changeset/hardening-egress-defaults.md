---
'@moonshot-ai/kimi-code': minor
---

Telemetry is opt-in in this fork. It previously ran unless the config said
`telemetry = false`, including when the config could not be read at all, so an
install that never made a choice still reported. It now runs only when the
config opts in; an unreadable config is treated as no consent rather than as
consent. `KIMI_DISABLE_TELEMETRY` continues to work as a hard override.

`KIMI_CODE_NO_TIPS=1` disables the startup tips fetch, which was the one
network call at launch with no way to turn it off — so an install configured
for no outbound traffic still beaconed on every run.
