import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import type {
  PermissionPolicy,
  PermissionPolicyResult,
} from '#/agent/permissionPolicy/types';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';

/**
 * Tools that auto mode does not blanket-approve.
 *
 * Auto mode exists to take friction out of ordinary work, and headless runs
 * (`kimi -p`) turn it on for the whole session. Bash runs arbitrary commands,
 * so approving it purely because the mode is `auto` turns any instruction the
 * model picked up — including one that arrived in a repo file, an issue, or a
 * fetched page — into an unreviewed shell execution.
 *
 * Excluding it here does not deny it: the call falls through to the rest of
 * the chain, so a user `[permission] allow` rule still authorizes it. That
 * makes the grant explicit and auditable instead of implied by the mode.
 */
const AUTO_MODE_EXCLUDED_TOOLS = new Set<string>(['Bash']);

/**
 * Escape hatch for operators who accept the risk and need the previous
 * behaviour (an existing unattended pipeline, say). Off by default.
 */
const AUTO_APPROVE_BASH_ENV = 'KIMI_CODE_AUTO_APPROVE_BASH';

function isEnvOptIn(env: NodeJS.ProcessEnv, name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env[name] ?? '').trim().toLowerCase());
}

export class AutoModeApprovePermissionPolicyService implements PermissionPolicy {
  readonly name = 'auto-mode-approve';

  constructor(
    @IAgentPermissionModeService private readonly modeService: IAgentPermissionModeService,
  ) {}

  evaluate(context: ResolvedToolExecutionHookContext): PermissionPolicyResult | undefined {
    if (this.modeService.mode !== 'auto') return undefined;
    if (
      AUTO_MODE_EXCLUDED_TOOLS.has(context.toolCall.name) &&
      !isEnvOptIn(process.env, AUTO_APPROVE_BASH_ENV)
    ) {
      return undefined;
    }
    return { kind: 'approve' };
  }
}
