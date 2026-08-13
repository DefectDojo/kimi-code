---
'@moonshot-ai/agent-core-v2': minor
---

Ask before writing a file that a later command will execute. Writes inside the
workspace are approved without prompting, which is right for source files — the
change is visible in the diff before anything runs it. It is not right for
`package.json`, `Makefile`, `.github/workflows/*`, `conftest.py`,
`.pre-commit-config.yaml` and friends: nothing happens when they are written,
and then the next install, test run or CI job executes what they now say. The
write is the dangerous act, so the prompt belongs there.

Reads are unaffected, ordinary source writes keep the fast path, and session
approvals and user `allow` rules still take precedence, so a decision already
made is not re-asked.
