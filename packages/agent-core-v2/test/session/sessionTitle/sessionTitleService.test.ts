import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { OAuthConnectionError, OAuthUnauthorizedError } from '@moonshot-ai/kimi-code-oauth';

import { DisposableStore, type IDisposable } from '#/_base/di/lifecycle';
import { type IAgentScopeHandle } from '#/_base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { createServices, type TestInstantiationService } from '#/_base/di/test';
import { Emitter } from '#/_base/event';
import { IOAuthService } from '#/app/auth/auth';
import { IEventService } from '#/app/event/event';
import type { Event2 } from '#/app/event/event2';
import { IHostRequestHeaders } from '#/llm-adapter/model/host-request-headers';
import {
  IProviderService,
  type OAuthRef,
  type ProviderConfig,
} from '#/llm-adapter/provider/provider';
import { ISessionContext, makeSessionContext } from '#/session/sessionContext/sessionContext';
import {
  IAgentLifecycleService,
  MAIN_AGENT_ID,
} from '#/session/agentLifecycle/agentLifecycle';
import {
  IAgentTitlePromptSource,
  type TitleDigestExcerpt,
  type TitleTurnExcerpt,
} from '#/session/sessionTitle/agentTitlePromptSource';
import { ISessionTitleService } from '#/session/sessionTitle/sessionTitle';
import {
  composeTitleInput,
  SessionTitleService,
} from '#/session/sessionTitle/sessionTitleService';
import {
  ISessionMetadata,
  type SessionMeta,
  type SessionMetaPatch,
  type SessionMetadataChangedEvent,
} from '#/session/sessionMetadata/sessionMetadata';
import { SessionMetaUpdated } from '#/session/sessionMetadata/sessionMetaEvents';

import { registerLogServices } from '../../_base/log/stubs';
import { stubProviderService } from '../../app/provider/stubs';

const SESSION_ID = 'sess-1';
const MANAGED_PROVIDER: ProviderConfig = {
  type: 'kimi',
  baseUrl: 'https://api.example.test/coding/v1',
  oauth: { storage: 'file', key: 'kimi-code' },
};

class FakeEventService implements IEventService {
  declare readonly _serviceBrand: undefined;
  private readonly emitter = new Emitter<Event2>();
  readonly onDidPublish = this.emitter.event;
  readonly published: Event2[] = [];

  publish(event: Event2): void {
    this.published.push(event);
    this.emitter.fire(event);
  }

  subscribe(handler: (event: Event2) => void): IDisposable {
    return this.emitter.event(handler);
  }
}

class FakeSessionMetadata implements ISessionMetadata {
  declare readonly _serviceBrand: undefined;
  readonly ready = Promise.resolve();
  private readonly emitter = new Emitter<SessionMetadataChangedEvent>();
  readonly onDidChangeMetadata = this.emitter.event;
  meta: SessionMeta;

  constructor() {
    this.meta = {
      id: SESSION_ID,
      createdAt: 0,
      updatedAt: 0,
      archived: false,
    };
  }

  read(): Promise<SessionMeta> {
    return Promise.resolve(this.meta);
  }

  update(patch: SessionMetaPatch): Promise<void> {
    this.meta = { ...this.meta, ...patch };
    this.emitter.fire({ changed: Object.keys(patch) as (keyof SessionMeta)[] });
    return Promise.resolve();
  }

  setTitle(title: string): Promise<void> {
    return this.update({ title, titleKind: 'custom' });
  }

  async setGeneratedTitleIfUncustomized(
    title: string,
    opts?: { force?: boolean },
  ): Promise<boolean> {
    if (opts?.force !== true && this.meta.titleKind === 'custom') return false;
    await this.update({ title, titleKind: 'generated' });
    return true;
  }

  setArchived(archived: boolean): Promise<void> {
    return this.update({ archived });
  }

  registerAgent(): Promise<void> {
    return Promise.resolve();
  }
}

function createPendingFetch() {
  let markStarted!: () => void;
  let resolveResponse!: (response: Response) => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });
  return {
    fetch: async () => {
      markStarted();
      return response;
    },
    started,
    resolve: resolveResponse,
  };
}

describe('SessionTitleService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let events: FakeEventService;
  let metadata: FakeSessionMetadata;
  let providers: Record<string, ProviderConfig>;
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  let tokenError: Error | undefined;
  let forceTokenError: Error | undefined;
  let resolvedOAuthRefs: Array<OAuthRef | undefined>;
  let titlePrompts: readonly string[];
  let promptSourceImpl: (limit: number) => Promise<readonly string[]>;
  let turnExcerpt: TitleTurnExcerpt;
  let digestExcerpt: TitleDigestExcerpt;
  let tokenCalls: boolean[];

  beforeEach(() => {
    tokenError = undefined;
    forceTokenError = undefined;
    resolvedOAuthRefs = [];
    titlePrompts = [];
    promptSourceImpl = async (limit) => titlePrompts.slice(0, limit);
    turnExcerpt = {};
    digestExcerpt = { turns: [] };
    tokenCalls = [];
    providers = { 'managed:kimi-code': MANAGED_PROVIDER };
    metadata = new FakeSessionMetadata();
    events = new FakeEventService();
    fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ title: '生成的标题' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    disposables = new DisposableStore();
    ix = createServices(disposables, {
      base: [registerLogServices],
      additionalServices: (reg) => {
        reg.defineInstance(
          ISessionContext,
          makeSessionContext({
            sessionId: SESSION_ID,
            workspaceId: 'ws-1',
            sessionDir: '/tmp/sess-1',
            sessionScope: 'sessions/sess-1',
            cwd: '/tmp',
          }),
        );
        reg.defineInstance(ISessionMetadata, metadata);
        const promptSource: IAgentTitlePromptSource = {
          _serviceBrand: undefined,
          firstUserPrompts: (limit) => promptSourceImpl(limit),
          firstTurnExcerpt: async () => turnExcerpt,
          digestExcerpt: async () => digestExcerpt,
        };
        const mainAgent: IAgentScopeHandle = {
          id: MAIN_AGENT_ID,
          kind: LifecycleScope.Agent,
          accessor: { get: <T>() => promptSource as T },
          dispose: () => undefined,
        };
        reg.definePartialInstance(IAgentLifecycleService, {
          handleOf: () => mainAgent,
        });
        reg.defineInstance(IEventService, events);
        reg.defineInstance(IProviderService, stubProviderService(providers));
        reg.definePartialInstance(IOAuthService, {
          resolveTokenProvider: (_provider, oauthRef) => {
            resolvedOAuthRefs.push(oauthRef);
            return {
              getAccessToken: async (options) => {
                tokenCalls.push(options?.force === true);
                if (tokenError !== undefined) throw tokenError;
                if (options?.force === true && forceTokenError !== undefined) {
                  throw forceTokenError;
                }
                return 'test-token';
              },
            };
          },
        });
        reg.defineInstance(IHostRequestHeaders, {
          headers: { 'User-Agent': 'test' },
          thirdPartyHeaders: {},
        });
        reg.define(ISessionTitleService, SessionTitleService);
      },
    });
    ix.get(ISessionTitleService);
  });

  afterEach(() => {
    disposables.dispose();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function promptSource(): IAgentTitlePromptSource {
    return {
      _serviceBrand: undefined,
      firstUserPrompts: (limit) => promptSourceImpl(limit),
      firstTurnExcerpt: async () => turnExcerpt,
      digestExcerpt: async () => digestExcerpt,
    };
  }

  describe('session title egress is disabled in this fork', () => {
    it('never calls the backend, whatever the source', async () => {
      titlePrompts = ['先帮我搭一个 Vite 项目'];
      turnExcerpt = { user: 'hello', assistant: 'hi there' };
      digestExcerpt = { turns: [{ user: 'a', assistant: 'b' }] };

      for (const source of ['user_prompts', 'first_turn', 'digest'] as const) {
        await expect(
          ix.get(ISessionTitleService).generateTitle({ source }),
        ).resolves.toBeUndefined();
      }

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not reach for an OAuth token either', async () => {
      titlePrompts = ['hello'];

      await ix.get(ISessionTitleService).generateTitle();

      expect(tokenCalls).toEqual([]);
      expect(resolvedOAuthRefs).toEqual([]);
    });

    it('refuses even when forced, and leaves a custom title intact', async () => {
      await metadata.setTitle('我的标题');
      titlePrompts = ['hello'];

      await expect(
        ix.get(ISessionTitleService).generateTitle({ force: true }),
      ).resolves.toBeUndefined();

      expect(fetchMock).not.toHaveBeenCalled();
      expect((await metadata.read()).title).toBe('我的标题');
    });

    it('leaves the locally derived title in place', async () => {
      await metadata.update({ title: 'Fix the parser', titleKind: 'replaceable' });
      titlePrompts = ['Fix the parser'];

      await ix.get(ISessionTitleService).generateTitle();

      const current = await metadata.read();
      expect(current.title).toBe('Fix the parser');
      expect(current.titleKind).toBe('replaceable');
    });

    it('publishes no metadata event, since nothing changed', async () => {
      titlePrompts = ['hello'];

      await ix.get(ISessionTitleService).generateTitle();

      expect(events.published).toEqual([]);
    });
  });

  describe('composeTitleInput', () => {
    it('composes the title input from the recorded prompts in order', async () => {
      titlePrompts = ['先帮我搭一个 Vite 项目', '加上路由', '现在配一下 ESLint'];

      await expect(composeTitleInput(promptSource(), 'user_prompts')).resolves.toBe(
        'user: 先帮我搭一个 Vite 项目\nuser: 加上路由\nuser: 现在配一下 ESLint',
      );
    });

    it('truncates each prompt to the per-prompt budget, keeping the head', async () => {
      titlePrompts = ['很长的输入'.repeat(400), '第二条'];

      await expect(composeTitleInput(promptSource(), 'user_prompts')).resolves.toBe(
        `user: ${'很长的输入'.repeat(80)}\nuser: 第二条`,
      );
    });

    it('first_turn composes the opening prompt with the first reply', async () => {
      turnExcerpt = { user: '帮我修一下构建', assistant: '好的，我先看看配置' };

      await expect(composeTitleInput(promptSource(), 'first_turn')).resolves.toBe(
        'user: 帮我修一下构建\nassistant: 好的，我先看看配置',
      );
    });

    it('first_turn is strict: no assistant reply yet means unavailable', async () => {
      turnExcerpt = { user: '帮我修一下构建' };

      await expect(composeTitleInput(promptSource(), 'first_turn')).resolves.toBeUndefined();
    });

    it('first_turn truncates each segment to its budget', async () => {
      turnExcerpt = { user: '用'.repeat(600), assistant: '助'.repeat(600) };

      await expect(composeTitleInput(promptSource(), 'first_turn')).resolves.toBe(
        `user: ${'用'.repeat(400)}\nassistant: ${'助'.repeat(300)}`,
      );
    });

    it('digest composes every turn as interleaved user/assistant lines', async () => {
      digestExcerpt = {
        turns: [
          { user: '第一问', assistant: '第一答' },
          { user: '第二问', assistant: '第二答' },
        ],
      };

      await expect(composeTitleInput(promptSource(), 'digest')).resolves.toBe(
        'user: 第一问\nassistant: 第一答\nuser: 第二问\nassistant: 第二答',
      );
    });

    it('digest truncates each segment to its budget', async () => {
      digestExcerpt = { turns: [{ user: '用'.repeat(400), assistant: '助'.repeat(400) }] };

      await expect(composeTitleInput(promptSource(), 'digest')).resolves.toBe(
        `user: ${'用'.repeat(200)}\nassistant: ${'助'.repeat(200)}`,
      );
    });

    it('digest is unavailable when the window yields no segments at all', async () => {
      digestExcerpt = { turns: [] };

      await expect(composeTitleInput(promptSource(), 'digest')).resolves.toBeUndefined();
    });

    it('digest elides the middle turns when the input exceeds the total budget', async () => {
      digestExcerpt = {
        turns: Array.from({ length: 20 }, (_, index) => ({
          user: `问题${String(index)}`.padEnd(200, '啊'),
          assistant: `回答${String(index)}`.padEnd(200, '嗯'),
        })),
      };

      const composed = await composeTitleInput(promptSource(), 'digest');

      expect(composed).toBeDefined();
      expect(composed!.length).toBeLessThanOrEqual(3000);
      expect(composed).toContain('...');
      expect(composed!.startsWith('user: 问题0')).toBe(true);
    });
  });

});
