/**
 * Sensitive-file detection.
 *
 * The pattern list is intentionally small to avoid false positives; files
 * matching any of these patterns are blocked from Read/Write/Edit so
 * credentials cannot be exfiltrated through a compromised prompt. Exemptions
 * like `.env.example` are explicitly allowed.
 */

import { basename } from 'pathe';

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

/**
 * Directories whose contents are credentials whatever the file is called.
 * Private keys and cloud credential files are routinely given local names
 * (`deploy_key`, `work-cluster.json`), so a basename list cannot cover them.
 * Public keys and the host-key caches carry no secret and stay readable.
 */
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

/**
 * `config` is a secret in `.kube` but not in `.ssh` (host aliases) or `.aws`
 * (region settings), so the exemption is per-directory rather than by name.
 */
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
  const name = basename(path);
  const comparableName = comparable(name);
  const comparablePath = comparable(path);

  if (ENV_EXEMPTIONS.has(comparableName)) return false;
  if (PUBLIC_KEY_BASENAMES.has(comparableName)) return false;
  if (SENSITIVE_BASENAMES.has(comparableName)) return true;
  if (comparableName.startsWith(ENV_PREFIX)) return true;

  for (const prefix of SENSITIVE_BASENAME_PREFIXES) {
    if (comparableName === prefix) return true;
    // Catch rename-shielded variants without flagging unrelated filenames
    // like `id_rsafoo` or ordinary JSON files like `credentials.json`.
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
