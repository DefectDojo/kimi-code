---
'@moonshot-ai/kimi-code': minor
'@moonshot-ai/agent-core-v2': minor
'@moonshot-ai/agent-core': minor
---

Tighten how code arrives on the machine.

The plugin catalog now has to be served over https from an allowed host
(`code.kimi.com` / `cdn.kimi.com` by default). The catalog picks which plugins
are offered and where their archives come from, and an installed plugin can
declare a spawnable `mcpServers` command, so whoever serves it effectively picks
code that runs locally. A self-hosted catalog is still possible by naming its
host in `KIMI_CODE_PLUGIN_MARKETPLACE_ALLOWED_HOSTS`.

Remote plugin archives must likewise use https. Plaintext to loopback stays
allowed for local dev and test servers, where there is no network path to
tamper with.

The native (`curl … install.sh | bash`) updater is no longer run unattended.
Nothing verifies what the CDN returns, so the command is now surfaced for the
user to run deliberately, matching what Windows already did.
