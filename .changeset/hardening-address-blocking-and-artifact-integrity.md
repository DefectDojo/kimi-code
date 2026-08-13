---
'@moonshot-ai/agent-core-v2': patch
'@moonshot-ai/agent-core': patch
---

Extend the URL-fetch private-address blocklist to cover NAT64-embedded IPv4
ranges (RFC 6052 `64:ff9b::/96` and the RFC 8215 local-use prefix), and give the
capability downloader optional SHA-256 verification that discards an artifact
whose digest does not match. The macOS computer-use bundle keeps its quarantine
attribute so Gatekeeper still evaluates it.
