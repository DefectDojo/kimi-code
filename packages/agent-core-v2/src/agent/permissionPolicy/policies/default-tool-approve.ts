import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';
import type {
  PermissionPolicy,
  PermissionPolicyResult,
} from '#/agent/permissionPolicy/types';

/**
 * Tools that run without asking.
 *
 * `FetchURL` is deliberately absent. It is the one tool here that sends
 * caller-chosen bytes to a caller-chosen host, which makes it the sink half of
 * an exfiltration pair: anything the agent can read, it could otherwise put in
 * a URL and ship out without the user seeing a prompt. The SSRF guard blocks
 * internal targets but not public ones, so the gate has to be approval rather
 * than address filtering. A user `[permission] allow = ["FetchURL"]` rule
 * restores the previous behaviour explicitly.
 */
const DEFAULT_APPROVE_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'SetTodoList',
  'TodoList',
  'TaskList',
  'TaskOutput',
  'CronList',
  'WebSearch',
  'Agent',
  'AgentSwarm',
  'AskUserQuestion',
  'Skill',
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
  'select_tools',
]);

export class DefaultToolApprovePermissionPolicyService implements PermissionPolicy {
  readonly name = 'default-tool-approve';

  evaluate(context: ResolvedToolExecutionHookContext): PermissionPolicyResult | undefined {
    return DEFAULT_APPROVE_TOOLS.has(context.toolCall.name)
      ? { kind: 'approve' }
      : undefined;
  }
}
