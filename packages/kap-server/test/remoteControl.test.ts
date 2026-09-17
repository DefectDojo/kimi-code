import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileTokenStorage,
  KIMI_CODE_PROVIDER_NAME,
  resolveKimiTokenStorageName,
  type TokenInfo,
} from '@moonshot-ai/kimi-code-oauth';
import { remoteControlLockPath } from '@moonshot-ai/remote-control';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';

import { ErrorCode } from '../src/protocol/error-codes';
import { writeServerToken } from '../src/services/auth/persistentToken';
import { type RunningServer, startServer } from '../src/start';
import { authedFetch } from './helpers/auth';
import { TEST_HOST_IDENTITY } from './helpers/hostIdentity';

interface Envelope<T> {
  code: number;
  msg: string;
  data: T;
  request_id: string;
}

interface RemoteControlStatusWire {
  enabled: boolean;
  state: 'off' | 'starting' | 'on';
  url?: string;
  device_id?: string;
  device_name?: string;
  error?: string;
}

const TOKEN: TokenInfo = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 0,
  scope: '',
  tokenType: 'Bearer',
  expiresIn: 0,
};

describe('server-v2 /api/v1/remote-control', () => {
  let home: string | undefined;
  let server: RunningServer | undefined;
  let base: string;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), 'kimi-server-v2-rc-'));
    await new FileTokenStorage(join(home, 'credentials')).save(
      resolveKimiTokenStorageName({ providerName: KIMI_CODE_PROVIDER_NAME }),
      TOKEN,
    );
    server = await startServer({
      hostIdentity: TEST_HOST_IDENTITY,
      host: '127.0.0.1',
      port: 0,
      homeDir: home,
      logLevel: 'silent',
    });
    base = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    if (server !== undefined) await server.close();
    if (home !== undefined) await rm(home, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function postRemoteControl(enabled: boolean): Promise<Envelope<RemoteControlStatusWire>> {
    const res = await authedFetch(server as RunningServer, base, '/api/v1/remote-control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Envelope<RemoteControlStatusWire>;
  }

  it('refuses to enable the tunnel', async () => {
    const relay = await startRegisterAckRelay();
    vi.stubEnv('KIMI_CODE_REMOTE_CONTROL_RELAY_URL', `http://127.0.0.1:${relay.port}`);
    try {
      const body = await postRemoteControl(true);

      expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
      expect(body.msg).toMatch(/disabled in this build/);
      expect(relay.managementSockets).toHaveLength(0);
      expect(relay.registrations).toHaveLength(0);

      const status = await authedFetch(server as RunningServer, base, '/api/v1/remote-control');
      const statusBody = (await status.json()) as Envelope<RemoteControlStatusWire>;
      expect(statusBody.data.state).toBe('off');
    } finally {
      await relay.close();
    }
  });

  it('refuses even on a loopback bind with auth enabled, which upstream allows', async () => {
    const body = await postRemoteControl(true);

    expect(body.code).toBe(ErrorCode.VALIDATION_FAILED);
  });

  it('still answers a disable request so the route is not broken', async () => {
    const body = await postRemoteControl(false);

    expect(body.code).toBe(0);
    expect(body.data.state).toBe('off');
  });
});

function rawDataText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data as ArrayBuffer).toString('utf8');
}

function nextJsonMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.once('message', (data) => {
      resolve(JSON.parse(rawDataText(data)) as Record<string, unknown>);
    });
  });
}

async function startRegisterAckRelay(): Promise<{
  port: number;
  registrations: unknown[];
  managementSockets: WebSocket[];
  httpSockets: WebSocket[];
  close(): Promise<void>;
}> {
  const managementServer = new WebSocketServer({ noServer: true });
  const httpTunnelServer = new WebSocketServer({ noServer: true });
  const relayServer = createServer();
  const registrations: unknown[] = [];
  const managementSockets: WebSocket[] = [];
  const httpSockets: WebSocket[] = [];
  managementServer.on('connection', (ws) => {
    managementSockets.push(ws);
    ws.on('error', () => {});
    ws.on('message', (data) => {
      const message = JSON.parse(rawDataText(data)) as { type?: string };
      if (message.type === 'register') {
        registrations.push(message);
        ws.send(JSON.stringify({ type: 'register_ack', payload: { success: true } }));
      }
    });
  });
  httpTunnelServer.on('connection', (ws) => {
    httpSockets.push(ws);
    ws.on('error', () => {});
  });
  relayServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '', 'http://relay.test').pathname;
    const target = pathname.endsWith('/v1/remote/create') ? managementServer : httpTunnelServer;
    target.handleUpgrade(request, socket, head, (ws) => target.emit('connection', ws, request));
  });
  const port = await new Promise<number>((resolve, reject) => {
    relayServer.once('error', reject);
    relayServer.listen(0, '127.0.0.1', () => {
      const address = relayServer.address();
      if (address === null || typeof address === 'string') reject(new Error('missing address'));
      else resolve(address.port);
    });
  });
  return {
    port,
    registrations,
    managementSockets,
    httpSockets,
    close: () =>
      new Promise((resolve, reject) => {
        relayServer.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error('condition timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
