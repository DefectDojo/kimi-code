import * as pathe from 'pathe';

import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';
import { IHostEnvironment } from '#/os/interface/hostEnvironment';
import type { IHostEnvironment as HostEnvironment } from '#/os/interface/hostEnvironment';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import type { ISessionWorkspaceContext as WorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import type {
  PermissionPolicy,
  PermissionPolicyResult,
} from '#/agent/permissionPolicy/types';

import { writeFileAccesses } from './path-utils';

/**
 * Files whose contents a routine follow-up command executes.
 *
 * Writes inside the workspace are otherwise approved without asking, which is
 * the right default for source files: editing them is the job, and the change
 * is visible in the diff before anything runs it. These are different. Nothing
 * happens when they are written, and then the next `npm install`, test run, or
 * CI job executes what they now say — so the write is the dangerous act and
 * the prompt has to happen there, not at the point it finally runs.
 */
const EXECUTION_TRIGGER_BASENAMES = new Set<string>([
  'package.json',
  'makefile',
  'gnumakefile',
  'justfile',
  'taskfile.yml',
  'taskfile.yaml',
  'jenkinsfile',
  'setup.py',
  'conftest.py',
  '.pre-commit-config.yaml',
  '.gitlab-ci.yml',
  'azure-pipelines.yml',
]);

/**
 * Directories where every file is executed by CI or a git operation.
 * Compared against workspace-relative POSIX paths.
 */
const EXECUTION_TRIGGER_DIR_PREFIXES = [
  '.github/workflows/',
  '.github/actions/',
  '.circleci/',
  '.husky/',
];

export function isExecutionTriggerPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll('\\', '/').toLowerCase();
  if (normalized.startsWith('../')) return false;
  if (EXECUTION_TRIGGER_BASENAMES.has(pathe.basename(normalized))) return true;
  return EXECUTION_TRIGGER_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/**
 * Ask before writing a file that a later command will execute.
 *
 * Sits ahead of the blanket in-workspace write approval, and ahead of auto
 * mode, for the same reason the sensitive-file check does: these are the
 * writes where "it was inside the repo" is not a good enough reason to skip
 * the prompt. Session history and user `allow` rules still take precedence,
 * so an operator who has decided this is fine is not asked twice.
 */
export class ExecutionTriggerWriteAskPermissionPolicyService implements PermissionPolicy {
  readonly name = 'execution-trigger-write-ask';

  constructor(
    @IHostEnvironment private readonly env: HostEnvironment,
    @ISessionWorkspaceContext private readonly workspace: WorkspaceContext,
  ) {}

  evaluate(context: ResolvedToolExecutionHookContext): PermissionPolicyResult | undefined {
    const cwd = this.workspace.workDir;
    if (cwd.length === 0) return undefined;
    const writes = writeFileAccesses(context);
    if (writes.length === 0) return undefined;

    const pathClass = this.env.pathClass;
    const base = pathClass === 'win32' ? cwd.toLowerCase() : cwd;
    const triggers = writes.some((access) => {
      const target = pathClass === 'win32' ? access.path.toLowerCase() : access.path;
      return isExecutionTriggerPath(pathe.relative(base, target));
    });
    return triggers ? { kind: 'ask' } : undefined;
  }
}
