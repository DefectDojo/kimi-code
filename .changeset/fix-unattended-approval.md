---
'@moonshot-ai/agent-core-v2': patch
---

Refuse instead of blocking when a tool needs approval in an unattended
session. Auto mode is documented as "fully autonomous, the agent will not ask
questions" and headless runs (`kimi -p`) turn it on for the whole session, so a
tool that falls outside auto-approval had nobody to answer its request and the
process waited forever. It now resolves as a refusal that names the tool and
says how to grant it deliberately.

`FetchURL` joins `Bash` in the set auto mode does not blanket-approve: it sends
caller-chosen bytes to a caller-chosen host, and an unattended session is
exactly where that would go unnoticed.
