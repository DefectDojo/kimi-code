---
'@moonshot-ai/agent-core-v2': minor
---

Re-check file-tool paths against their symlink-resolved target before reading,
writing or editing. Path canonicalization is lexical, so a symlink sitting
inside the workspace reads as inside it while the OS follows the link at open
time. Read, Write and Edit now resolve the longest existing prefix of the path
and require that a path which looked in-workspace is still in-workspace once
symlinks are resolved, and that the resolved target is not a sensitive file even
when the link itself is innocuously named. Paths the caller already gave as
outside the workspace are unaffected — those remain the approval layer's call.
