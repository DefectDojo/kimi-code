---
'@moonshot-ai/kimi-code': minor
---

Session titles are generated locally. The `chat_title` request, which sent an
excerpt of the conversation to the managed platform purely to produce a
display string, is no longer made.

Sessions are still titled: the first prompt already supplies a local title,
and that text is run through the secret redactor first.
