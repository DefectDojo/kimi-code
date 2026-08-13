---
'@moonshot-ai/agent-core-v2': minor
---

Stop granting two privileges by default.

Auto mode no longer blanket-approves `Bash`. Auto mode exists to take friction
out of ordinary work and headless runs (`kimi -p`) turn it on for a whole
session, which meant a shell command the model chose — possibly on the strength
of text it read from a repo file, an issue, or a fetched page — ran unreviewed.
Bash now falls through to the rest of the policy chain, so a user
`[permission] allow` rule still authorizes it, explicitly and auditably. Set
`KIMI_CODE_AUTO_APPROVE_BASH=1` to restore the previous behaviour.

`FetchURL` is no longer in the default auto-approve set. It is the one
auto-approved tool that sends caller-chosen bytes to a caller-chosen host,
making it the sink half of an exfiltration pair; the SSRF guard blocks internal
targets but not public ones, so the gate has to be approval. A
`[permission] allow = ["FetchURL"]` rule restores it.
