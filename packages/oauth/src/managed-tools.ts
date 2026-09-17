/**
 * Managed-platform `/tools` dispatch: POSTs `{method, params}` to
 * `{kimiCodeBaseUrl}/tools` with a Bearer access token, the same wire
 * shape the backend tool surface expects (see `chat_title` below).
 *
 * `chat_title` generates a short session title from a chat excerpt:
 *
 *   { "method": "chat_title", "params": { "chat_content": "user: ...\nassistant: ..." } }
 *   → { "title": "..." }
 */

import { readApiErrorMessage } from './api-error';
import { kimiCodeBaseUrl } from './managed-usage';
import { isRecord } from './utils';

export interface FetchChatTitleOk {
  readonly kind: 'ok';
  readonly title: string;
}

export interface FetchChatTitleError {
  readonly kind: 'error';
  readonly status?: number;
  readonly message: string;
}

export type FetchChatTitleResult = FetchChatTitleOk | FetchChatTitleError;

export function kimiCodeToolsUrl(baseUrl?: string): string {
  return `${(baseUrl ?? kimiCodeBaseUrl()).replace(/\/+$/, '')}/tools`;
}

/**
 * Session-title generation is disabled in this fork.
 *
 * `chat_title` posts an excerpt of the conversation — the user's prompt and
 * the assistant's reply — to the managed platform purely to produce a display
 * string for the session list. It is the only call in the product that sends
 * conversation content anywhere other than the configured model provider, so
 * with a third-party model backend it is a second, unrelated destination for
 * the same text.
 *
 * Upstream gated this behind an `auto_session_title` experimental flag. That
 * flag no longer exists anywhere in the tree, and the bundled web UI fires the
 * request unprompted on the first turn, so there is nothing left to turn off.
 *
 * Nothing is lost by refusing. `applyPromptMetadataUpdate` already sets a
 * `replaceable` title locally from the first prompt, via
 * `titleFromPromptMetadataText`, and that text is run through the secret
 * redactor first. Sessions stay titled; the title is a truncated prompt rather
 * than a generated phrase.
 *
 * This is the chokepoint: it is the only function that sends `chat_title`, so
 * refusing here also covers any caller a later upstream merge introduces.
 */
export const SESSION_TITLE_EGRESS_DISABLED_MESSAGE =
  'Session-title generation is disabled in this build: it would send a conversation ' +
  'excerpt to the managed platform. Sessions are titled locally from the first prompt.';

export async function fetchChatTitle(
  _url: string,
  _accessToken: string,
  _chatContent: string,
  _opts: { timeoutMs?: number; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<FetchChatTitleResult> {
  return { kind: 'error', message: SESSION_TITLE_EGRESS_DISABLED_MESSAGE };
}

/**
 * Upstream's implementation, unchanged and unreachable in this fork. Kept so
 * upstream's own tests keep running against it and upstream changes still
 * merge cleanly rather than conflicting against a deleted function.
 */
export async function fetchChatTitleRemote(
  url: string,
  accessToken: string,
  chatContent: string,
  opts: { timeoutMs?: number; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<FetchChatTitleResult> {
  const controller = new AbortController();
  const onExternalAbort = () => {
    controller.abort();
  };
  if (opts.signal !== undefined) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? 8000);
  try {
    const headers = new Headers(opts.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        method: 'chat_title',
        params: { chat_content: chatContent },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        kind: 'error',
        status: res.status,
        message: await readApiErrorMessage(
          res,
          `Failed to generate session title: HTTP ${String(res.status)}`,
        ),
      };
    }
    const title = parseChatTitle(await res.json());
    if (title === undefined) {
      return { kind: 'error', message: 'Failed to generate session title: missing title.' };
    }
    return { kind: 'ok', title };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const reason =
        opts.signal?.aborted === true ? 'request aborted.' : 'request timed out.';
      return { kind: 'error', message: `Failed to generate session title: ${reason}` };
    }
    const msg = error instanceof Error ? error.message : String(error);
    return { kind: 'error', message: `Failed to generate session title: ${msg}` };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function parseChatTitle(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload['title'];
  if (typeof value !== 'string') return undefined;
  const title = value.trim();
  return title.length > 0 ? title : undefined;
}
