import { describe, expect, it } from 'vitest';

import { isSensitiveFile } from '../../../src/tools/policies/sensitive';

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
    // Mirrors the py parametrization exactly. `.envrc`, `environment.py`,
    // `.env_example`, `server.key.example`, `id_rsa.pub`, `credentials.json`
    // (basename is `credentials.json`, not the bare `credentials` token) must
    // all pass through.
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

  it('treats credential directories as sensitive whatever the file is called', () => {
    for (const path of [
      '/home/u/.ssh/deploy_key',
      '/home/u/.ssh/work-key',
      '/home/u/.gnupg/secring.gpg',
      '/home/u/.aws/sso-cache.json',
      '/home/u/.azure/accessTokens.json',
      '/home/u/.kube/config',
      '/home/u/.config/gcloud/application_default_credentials.json',
      '/home/u/.kimi-code/credentials/kimi.json',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('treats well-known credential files as sensitive', () => {
    for (const path of [
      '/home/u/.git-credentials',
      '/home/u/.netrc',
      '/home/u/.npmrc',
      '/home/u/.pypirc',
      '/home/u/.docker/config.json',
      '/home/u/.kimi-code/config.toml',
      '/home/u/kubeconfig',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('leaves non-secret files inside credential directories readable', () => {
    for (const path of [
      '/home/u/.ssh/known_hosts',
      '/home/u/.ssh/config',
      '/home/u/.ssh/deploy_key.pub',
      '/home/u/.aws/config',
    ]) {
      expect(isSensitiveFile(path), path).toBe(false);
    }
  });
});
