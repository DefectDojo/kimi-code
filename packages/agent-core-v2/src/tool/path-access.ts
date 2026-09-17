import * as pathe from 'pathe';

import {
  getShellPathBridge,
  translateShellDrivePath,
  type ShellPathBridge,
} from '#/_base/execEnv/shellPathBridge';
import type { IHostEnvironment } from '#/os/interface/hostEnvironment';

export interface WorkspaceConfig {
  readonly workspaceDir: string;
  readonly additionalDirs: readonly string[];
}

const SENSITIVE_BASENAMES = new Set<string>([
  '.env',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'credentials',
  '.git-credentials',
  '.netrc',
  '_netrc',
  '.npmrc',
  '.pypirc',
  '.dockercfg',
  'kubeconfig',
]);

const SENSITIVE_PATH_SUFFIXES = [
  ['.aws', 'credentials'],
  ['.gcp', 'credentials'],
  ['.docker', 'config.json'],
  ['.kimi-code', 'config.toml'],
];

const SENSITIVE_DIRECTORY_SEGMENTS: readonly (readonly string[])[] = [
  ['.ssh'],
  ['.gnupg'],
  ['.aws'],
  ['.azure'],
  ['.kube'],
  ['.config', 'gcloud'],
  ['.kimi-code', 'credentials'],
];

const SENSITIVE_DIRECTORY_EXEMPT_BASENAMES = new Set<string>([
  'known_hosts',
  'known_hosts.old',
]);

const SENSITIVE_DIRECTORY_EXEMPT_SUFFIXES = ['.ssh/config', '.aws/config'];

const ENV_PREFIX = '.env.';
const ENV_EXEMPTIONS = new Set<string>(['.env.example', '.env.sample', '.env.template']);

const SENSITIVE_BASENAME_PREFIXES = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'credentials'];
const PUBLIC_KEY_BASENAMES = new Set<string>(['id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub']);
export const SENSITIVE_DOT_VARIANT_SUFFIXES = [
  '.bak',
  '.backup',
  '.copy',
  '.disabled',
  '.key',
  '.old',
  '.orig',
  '.pem',
  '.save',
  '.tmp',
] as const;
const SENSITIVE_DOT_VARIANT_SUFFIX_SET = new Set<string>(SENSITIVE_DOT_VARIANT_SUFFIXES);

function comparable(path: string): string {
  return path.toLowerCase();
}

export function isSensitiveFile(path: string): boolean {
  const name = pathe.basename(path);
  const comparableName = comparable(name);
  const comparablePath = comparable(path);

  if (ENV_EXEMPTIONS.has(comparableName)) return false;
  if (PUBLIC_KEY_BASENAMES.has(comparableName)) return false;
  if (SENSITIVE_BASENAMES.has(comparableName)) return true;
  if (comparableName.startsWith(ENV_PREFIX)) return true;

  for (const prefix of SENSITIVE_BASENAME_PREFIXES) {
    if (comparableName === prefix) return true;
    if (comparableName.length > prefix.length && comparableName.startsWith(prefix)) {
      const suffix = comparableName.slice(prefix.length);
      const next = suffix[0];
      if (next === '-' || next === '_') return true;
      if (next === '.' && SENSITIVE_DOT_VARIANT_SUFFIX_SET.has(suffix)) return true;
    }
  }

  for (const suffixParts of SENSITIVE_PATH_SUFFIXES) {
    const suffix = suffixParts.join('/');
    const comparableSuffix = comparable(suffix);
    if (
      comparablePath.endsWith(`/${comparableSuffix}`) ||
      comparablePath.includes(`/${comparableSuffix}/`)
    ) {
      return true;
    }
  }

  if (
    !comparableName.endsWith('.pub') &&
    !SENSITIVE_DIRECTORY_EXEMPT_BASENAMES.has(comparableName) &&
    !SENSITIVE_DIRECTORY_EXEMPT_SUFFIXES.some((suffix) => comparablePath.endsWith(`/${suffix}`))
  ) {
    for (const segments of SENSITIVE_DIRECTORY_SEGMENTS) {
      const dir = comparable(segments.join('/'));
      if (comparablePath.includes(`/${dir}/`)) return true;
    }
  }

  return false;
}

export type PathClass = 'posix' | 'win32';
export type PathSecurityCode = 'PATH_OUTSIDE_WORKSPACE' | 'PATH_SENSITIVE' | 'PATH_INVALID';
export type PathAccessOperation = 'read' | 'write' | 'search';
export type WorkspaceGuardMode = 'absolute-outside-allowed' | 'disabled';

export interface WorkspaceAccessPolicy {
  readonly guardMode: WorkspaceGuardMode;
  readonly checkSensitive: boolean;
}

export const DEFAULT_WORKSPACE_ACCESS_POLICY: WorkspaceAccessPolicy = {
  guardMode: 'absolute-outside-allowed',
  checkSensitive: true,
};

export interface PathAccess {
  readonly path: string;
  readonly outsideWorkspace: boolean;
}

export class PathSecurityError extends Error {
  readonly code: PathSecurityCode;
  readonly rawPath: string;
  readonly canonicalPath: string;

  constructor(code: PathSecurityCode, rawPath: string, canonicalPath: string, message: string) {
    super(message);
    this.name = 'PathSecurityError';
    this.code = code;
    this.rawPath = rawPath;
    this.canonicalPath = canonicalPath;
  }
}

const DEFAULT_PATH_CLASS: PathClass = process.platform === 'win32' ? 'win32' : 'posix';

function isWin32DriveRelative(path: string): boolean {
  return /^[A-Za-z]:(?:$|[^\\/])/.test(path);
}

export function normalizeUserPath(path: string, pathClass: PathClass = DEFAULT_PATH_CLASS): string {
  return pathClass === 'win32' ? translateShellDrivePath(path) : path;
}

function expandUserPath(path: string, homeDir: string | undefined, pathClass: PathClass): string {
  if (homeDir === undefined) return path;
  if (path === '~') return homeDir;
  if (path.startsWith('~/') || (pathClass === 'win32' && path.startsWith('~\\'))) {
    return pathe.join(homeDir, path.slice(2));
  }
  return path;
}

export function canonicalizePath(
  path: string,
  cwd: string,
  pathClass: PathClass = DEFAULT_PATH_CLASS,
): string {
  if (path === '') {
    throw new PathSecurityError('PATH_INVALID', path, path, 'Path cannot be empty');
  }
  const normalizedPath = normalizeUserPath(path, pathClass);
  if (pathClass === 'win32' && isWin32DriveRelative(normalizedPath)) {
    throw new PathSecurityError(
      'PATH_INVALID',
      path,
      normalizedPath,
      `"${path}" is a drive-relative Windows path. Use an absolute path like C:\\path or a path relative to the working directory.`,
    );
  }
  if (!pathe.isAbsolute(normalizedPath) && !pathe.isAbsolute(cwd)) {
    throw new PathSecurityError(
      'PATH_INVALID',
      path,
      normalizedPath,
      `Cannot resolve "${path}" against non-absolute cwd "${cwd}".`,
    );
  }
  const abs = pathe.isAbsolute(normalizedPath) ? normalizedPath : pathe.resolve(cwd, normalizedPath);
  return pathe.normalize(abs);
}

export function isWithinDirectory(
  candidate: string,
  base: string,
  pathClass: PathClass = DEFAULT_PATH_CLASS,
): boolean {
  const nc = pathe.normalize(candidate);
  const nb = pathe.normalize(base);
  const comparableCandidate = pathClass === 'win32' ? nc.toLowerCase() : nc;
  const comparableBase = pathClass === 'win32' ? nb.toLowerCase() : nb;
  if (comparableCandidate === comparableBase) return true;
  const prefix = comparableBase.endsWith('/') ? comparableBase : comparableBase + '/';
  return comparableCandidate.startsWith(prefix);
}

export function isWithinWorkspace(
  candidate: string,
  config: WorkspaceConfig,
  pathClass: PathClass = DEFAULT_PATH_CLASS,
): boolean {
  if (isWithinDirectory(candidate, config.workspaceDir, pathClass)) return true;
  for (const dir of config.additionalDirs) {
    if (isWithinDirectory(candidate, dir, pathClass)) return true;
  }
  return false;
}

export function extendWorkspaceWithSkillRoots<T extends WorkspaceConfig>(
  workspace: T,
  skillRoots: readonly string[],
  pathClass: PathClass = DEFAULT_PATH_CLASS,
): T {
  const additionalDirs = [...workspace.additionalDirs];
  for (const root of skillRoots) {
    if (isWithinDirectory(root, workspace.workspaceDir, pathClass)) continue;
    if (additionalDirs.some((dir) => isWithinDirectory(root, dir, pathClass))) continue;
    additionalDirs.push(root);
  }
  if (additionalDirs.length === workspace.additionalDirs.length) return workspace;
  return { ...workspace, additionalDirs };
}

export interface AssertPathOptions {
  readonly mode: PathAccessOperation;
  readonly checkSensitive?: boolean | undefined;
  readonly pathClass?: PathClass | undefined;
}

export interface ResolvePathAccessOptions {
  readonly operation: PathAccessOperation;
  readonly policy?: WorkspaceAccessPolicy | undefined;
  readonly pathClass?: PathClass | undefined;
  readonly homeDir?: string;
  readonly shellPathBridge?: ShellPathBridge;
}

export interface ResolvePathAccessPathOptions {
  readonly env: Pick<
    IHostEnvironment,
    'pathClass' | 'homeDir' | 'osKind' | 'shellName' | 'shellPath'
  >;
  readonly workspace: WorkspaceConfig;
  readonly operation: PathAccessOperation;
  readonly policy?: WorkspaceAccessPolicy;
  readonly expandHome?: boolean;
}

function relativeOutsideMessage(path: string, operation: PathAccessOperation): string {
  const verb =
    operation === 'write'
      ? 'write or edit a file'
      : operation === 'search'
        ? 'search'
        : 'read a file';
  return (
    `"${path}" is not an absolute path. ` +
    `You must provide an absolute path to ${verb} outside the working directory.`
  );
}

export function resolvePathAccess(
  path: string,
  cwd: string,
  config: WorkspaceConfig,
  options: ResolvePathAccessOptions,
): PathAccess {
  const pathClass = options.pathClass ?? DEFAULT_PATH_CLASS;
  const normalizedPath =
    options.shellPathBridge?.fromShellPath(path) ?? normalizeUserPath(path, pathClass);
  const expandedPath = expandUserPath(normalizedPath, options.homeDir, pathClass);
  const rawIsAbsolute = pathe.isAbsolute(expandedPath);
  const canonical = canonicalizePath(expandedPath, cwd, pathClass);
  const outsideWorkspace = !isWithinWorkspace(canonical, config, pathClass);
  const policy = options.policy ?? DEFAULT_WORKSPACE_ACCESS_POLICY;

  if (policy.checkSensitive && isSensitiveFile(canonical)) {
    throw new PathSecurityError(
      'PATH_SENSITIVE',
      path,
      canonical,
      `"${path}" matches a sensitive-file pattern (env / credential / SSH key). ` +
        `Access is blocked to protect secrets.`,
    );
  }

  if (outsideWorkspace) {
    switch (policy.guardMode) {
      case 'absolute-outside-allowed':
        if (!rawIsAbsolute) {
          throw new PathSecurityError(
            'PATH_OUTSIDE_WORKSPACE',
            path,
            canonical,
            relativeOutsideMessage(path, options.operation),
          );
        }
        break;
      case 'disabled':
        break;
    }
  }

  return { path: canonical, outsideWorkspace };
}

export function resolvePathAccessPath(
  path: string,
  options: ResolvePathAccessPathOptions,
): string {
  const { env, workspace, operation, policy, expandHome = true } = options;
  return resolvePathAccess(path, workspace.workspaceDir, workspace, {
    operation,
    policy,
    pathClass: env.pathClass,
    homeDir: expandHome ? env.homeDir : undefined,
    shellPathBridge: env.pathClass === 'win32' ? getShellPathBridge(env) : undefined,
  }).path;
}

export interface PathRealpathResolver {
  realpath(path: string): Promise<string>;
}

export interface AssertRealPathOptions {
  readonly pathClass?: PathClass | undefined;
  readonly checkSensitive?: boolean | undefined;
}

async function realpathExistingPrefix(abs: string, fs: PathRealpathResolver): Promise<string> {
  const tail: string[] = [];
  let current = abs;
  for (let i = 0; i < 256; i++) {
    try {
      const real = await fs.realpath(current);
      return tail.length === 0 ? real : pathe.join(real, ...tail.toReversed());
    } catch {
      const parent = pathe.dirname(current);
      if (parent === current) return abs;
      tail.push(pathe.basename(current));
      current = parent;
    }
  }
  return abs;
}

async function realWorkspaceRoots(
  config: WorkspaceConfig,
  fs: PathRealpathResolver,
): Promise<readonly string[]> {
  const roots: string[] = [];
  for (const dir of [config.workspaceDir, ...config.additionalDirs]) {
    try {
      roots.push(await fs.realpath(dir));
    } catch {
      roots.push(dir);
    }
  }
  return roots;
}

export async function assertRealPathAccess(
  canonicalPath: string,
  rawPath: string,
  config: WorkspaceConfig,
  fs: PathRealpathResolver,
  options: AssertRealPathOptions = {},
): Promise<void> {
  const pathClass = options.pathClass ?? DEFAULT_PATH_CLASS;
  const checkSensitive = options.checkSensitive ?? DEFAULT_WORKSPACE_ACCESS_POLICY.checkSensitive;
  const realPath = await realpathExistingPrefix(canonicalPath, fs);
  if (realPath === canonicalPath) return;

  if (checkSensitive && isSensitiveFile(realPath)) {
    throw new PathSecurityError(
      'PATH_SENSITIVE',
      rawPath,
      realPath,
      `"${rawPath}" resolves through a symlink to a sensitive file ` +
        `(env / credential / SSH key). Access is blocked to protect secrets.`,
    );
  }

  if (!isWithinWorkspace(canonicalPath, config, pathClass)) return;

  const roots = await realWorkspaceRoots(config, fs);
  if (roots.some((root) => isWithinDirectory(realPath, root, pathClass))) return;

  throw new PathSecurityError(
    'PATH_OUTSIDE_WORKSPACE',
    rawPath,
    realPath,
    `"${rawPath}" resolves through a symlink to "${realPath}", which is outside the workspace.`,
  );
}

export function assertPathAllowed(
  path: string,
  cwd: string,
  config: WorkspaceConfig,
  options: AssertPathOptions,
): string {
  return resolvePathAccess(path, cwd, config, {
    operation: options.mode,
    pathClass: options.pathClass,
    policy: {
      guardMode: 'absolute-outside-allowed',
      checkSensitive: options.checkSensitive ?? DEFAULT_WORKSPACE_ACCESS_POLICY.checkSensitive,
    },
  }).path;
}
