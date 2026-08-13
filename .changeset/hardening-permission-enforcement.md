---
'@moonshot-ai/agent-core-v2': minor
---

Make the permission layer enforce what it is configured to enforce:

- Seed each agent with the user's `[permission]` rules from config. The rules Op
  is not persisted, so the model always started empty and configured
  allow/deny/ask rules never reached the policy chain.
- Order the sensitive-file and git-control asks ahead of the blanket auto-mode
  approval, so auto mode no longer waives them. An explicit prior approval or a
  user `allow` rule still wins, so nothing already approved re-prompts.
- Fail closed when no approval broker is bound: a call that reached the "ask"
  path is now blocked instead of being treated as approved.
