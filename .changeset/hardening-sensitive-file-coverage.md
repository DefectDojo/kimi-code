---
'@moonshot-ai/agent-core-v2': minor
'@moonshot-ai/agent-core': minor
---

Widen sensitive-file coverage for the file tools. Credential directories
(`.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.config/gcloud`, the CLI's own
`credentials` dir) are now treated as sensitive whatever the file inside is
called, since private keys and cloud credential files routinely carry local
names a basename list cannot predict. Adds the common credential files
(`.git-credentials`, `.netrc`, `.npmrc`, `.pypirc`, `.docker/config.json`,
`kubeconfig`, the CLI's own `config.toml`). Public keys, `known_hosts`,
`.ssh/config` and `.aws/config` stay readable.

Grep and Glob now apply the sensitive-file check that Read, Write and Edit
already applied, so searching cannot return the contents of files those tools
refuse to open.
