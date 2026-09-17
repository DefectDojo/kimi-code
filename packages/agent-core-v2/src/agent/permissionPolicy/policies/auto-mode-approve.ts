import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import type {
  PermissionPolicy,
  PermissionPolicyResult,
} from '#/agent/permissionPolicy/types';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';

const AUTO_MODE_EXCLUDED_TOOLS = new Set<string>(['Bash', 'FetchURL']);

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
