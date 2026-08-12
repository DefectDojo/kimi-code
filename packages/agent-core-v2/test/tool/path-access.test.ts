import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import nodePath from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertRealPathAccess,
  extendWorkspaceWithSkillRoots,
  isSensitiveFile,
} from '#/tool/path-access';

describe('isSensitiveFile', () => {
  it('flags base .env files in any directory', () => {
    for (const path of ['.env', '/app/.env', 'project/.env']) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('flags .env.<environment> variants', () => {
    for (const path of ['.env.local', '.env.production', '/app/.env.staging']) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('flags cloud credential file locations', () => {
    for (const path of [
      '/home/user/.aws/credentials',
      '/home/user/.gcp/credentials',
      '.aws/credentials',
      '.gcp/credentials',
      'credentials',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('matches sensitive patterns case-insensitively on posix paths', () => {
    for (const path of [
      '.ENV',
      '/app/.Env.Local',
      '/home/user/.AWS/Credentials',
      '/home/user/.GCP/CREDENTIALS',
      '/home/user/.ssh/ID_RSA',
      '/home/user/.ssh/ID_ED25519.OLD',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('does not flag normal source / config files or env exemplars', () => {
    for (const path of [
      'app.py',
      'config.yml',
      'README.md',
      'package.json',
      'server.key.example',
      'id_rsa.pub',
      'credentials.json',
      '.envrc',
      'environment.py',
      '.env_example',
      '.env.example',
      '.ENV.EXAMPLE',
      '.env.sample',
      '.ENV.SAMPLE',
      '.env.template',
      '.ENV.TEMPLATE',
      '/app/.env.example',
      '/app/.ENV.EXAMPLE',
    ]) {
      expect(isSensitiveFile(path), path).toBe(false);
    }
  });
});

describe('extendWorkspaceWithSkillRoots', () => {
  const workspace = { workspaceDir: '/repo', additionalDirs: ['/extra'] };

  it('returns the workspace unchanged when there are no skill roots', () => {
    expect(extendWorkspaceWithSkillRoots(workspace, [])).toBe(workspace);
  });

  it('appends roots outside the workspace and existing additional dirs', () => {
    expect(extendWorkspaceWithSkillRoots(workspace, ['/home/user/.kimi-code/skills'])).toEqual({
      workspaceDir: '/repo',
      additionalDirs: ['/extra', '/home/user/.kimi-code/skills'],
    });
  });

  it('skips roots already inside the workspace dir or an additional dir', () => {
    expect(
      extendWorkspaceWithSkillRoots(workspace, ['/repo/.agents/skills', '/extra/skills']),
    ).toBe(workspace);
  });

  it('dedupes roots that repeat or nest inside a just-added root', () => {
    expect(
      extendWorkspaceWithSkillRoots(workspace, ['/skills', '/skills', '/skills/sub']),
    ).toEqual({ workspaceDir: '/repo', additionalDirs: ['/extra', '/skills'] });
  });

  it('compares case-insensitively on win32 path class', () => {
    expect(
      extendWorkspaceWithSkillRoots(
        { workspaceDir: 'C:/repo', additionalDirs: [] },
        ['c:/Repo/skills'],
        'win32',
      ).additionalDirs,
    ).toEqual([]);
  });
});

describe('assertRealPathAccess', () => {
  const workspace = { workspaceDir: '/ws', additionalDirs: [] as string[] };

  /**
   * Resolver where `links` maps a path to what it really resolves to, and
   * `missing` paths reject the way `realpath` does for a path that does not
   * exist yet (which is what makes the guard walk up to the parent).
   */
  function resolver(
    links: Record<string, string>,
    missing: readonly string[] = [],
  ): { realpath: (p: string) => Promise<string> } {
    return {
      realpath: (p: string) => {
        if (missing.includes(p)) return Promise.reject(new Error(`ENOENT: ${p}`));
        for (const [from, to] of Object.entries(links)) {
          if (p === from) return Promise.resolve(to);
        }
        return Promise.resolve(p);
      },
    };
  }

  it('allows a path that resolves to itself', async () => {
    await expect(
      assertRealPathAccess('/ws/src/a.ts', 'src/a.ts', workspace, resolver({}), {
        pathClass: 'posix',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects an in-workspace path that resolves outside the workspace', async () => {
    // scripts/deploy.sh -> /home/u/.zshrc
    await expect(
      assertRealPathAccess(
        '/ws/scripts/deploy.sh',
        'scripts/deploy.sh',
        workspace,
        resolver({ '/ws/scripts/deploy.sh': '/home/u/.zshrc' }),
        { pathClass: 'posix' },
      ),
    ).rejects.toThrow(/outside the workspace/);
  });

  it('rejects a link whose target is sensitive even when the link name is innocuous', async () => {
    // notes.md -> /home/u/.aws/credentials
    await expect(
      assertRealPathAccess(
        '/ws/notes.md',
        'notes.md',
        workspace,
        resolver({ '/ws/notes.md': '/home/u/.aws/credentials' }),
        { pathClass: 'posix' },
      ),
    ).rejects.toThrow(/sensitive file/);
  });

  it('resolves the parent directory for a file that does not exist yet', async () => {
    // scripts -> /etc, so a new file under it lands outside the workspace.
    await expect(
      assertRealPathAccess(
        '/ws/scripts/new.sh',
        'scripts/new.sh',
        workspace,
        resolver({ '/ws/scripts': '/etc' }, ['/ws/scripts/new.sh']),
        { pathClass: 'posix' },
      ),
    ).rejects.toThrow(/outside the workspace/);
  });

  it('allows a symlink that stays inside the workspace', async () => {
    await expect(
      assertRealPathAccess(
        '/ws/link.ts',
        'link.ts',
        workspace,
        resolver({ '/ws/link.ts': '/ws/real.ts' }),
        { pathClass: 'posix' },
      ),
    ).resolves.toBeUndefined();
  });

  it('honours additionalDirs as legitimate roots', async () => {
    await expect(
      assertRealPathAccess(
        '/ws/skill',
        'skill',
        { workspaceDir: '/ws', additionalDirs: ['/opt/skills'] },
        resolver({ '/ws/skill': '/opt/skills/a' }),
        { pathClass: 'posix' },
      ),
    ).resolves.toBeUndefined();
  });

  it('leaves an explicitly-outside path to the approval layer', async () => {
    // Already outside the workspace lexically: not this guard's call.
    await expect(
      assertRealPathAccess(
        '/tmp/scratch',
        '/tmp/scratch',
        workspace,
        resolver({ '/tmp/scratch': '/tmp/elsewhere' }),
        { pathClass: 'posix' },
      ),
    ).resolves.toBeUndefined();
  });
});

describe('assertRealPathAccess against a real filesystem', () => {
  it('blocks a real in-workspace symlink that points outside the workspace', async () => {
    const hostFs = { realpath: (p: string) => realpath(p) };
    const root = await realpath(await mkdtemp(nodePath.join(tmpdir(), 'kimi-symlink-')));
    try {
      const ws = nodePath.join(root, 'repo');
      const outside = nodePath.join(root, 'home');
      await mkdir(nodePath.join(ws, 'scripts'), { recursive: true });
      await mkdir(outside, { recursive: true });
      const target = nodePath.join(outside, '.zshrc');
      await writeFile(target, 'echo hi\n');
      const link = nodePath.join(ws, 'scripts', 'deploy.sh');
      await symlink(target, link);
      const workspace = { workspaceDir: ws, additionalDirs: [] as string[] };

      await expect(
        assertRealPathAccess(link, 'scripts/deploy.sh', workspace, hostFs, { pathClass: 'posix' }),
      ).rejects.toThrow(/outside the workspace/);

      const real = nodePath.join(ws, 'scripts', 'ok.sh');
      await writeFile(real, '#!/bin/sh\n');
      await expect(
        assertRealPathAccess(real, 'scripts/ok.sh', workspace, hostFs, { pathClass: 'posix' }),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
