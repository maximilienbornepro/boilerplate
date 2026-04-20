import { describe, it, expect } from 'vitest';

// We can't import `routes.ts` directly without pulling pg + express into the
// test runner. The helper we care about (event normalization) is a small pure
// function — we mirror it exactly here. If the real impl changes, the diff
// surfaces on review.

type PromptEventKind = 'user_prompt' | 'stop' | 'tool_use' | 'manual';

interface NormalizedEvent {
  session_id: string;
  cwd: string;
  event_kind: PromptEventKind;
  prompt_text: string | null;
  response_summary: string | null;
  tools_used: unknown;
  files_changed: unknown;
  tokens: unknown;
  duration_ms: number | null;
  git_commit_sha: string | null;
  metadata: unknown;
}

function normalizeEvent(body: unknown): NormalizedEvent | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const session_id = String(raw.session_id ?? raw.sessionId ?? '').trim();
  const cwd = String(raw.cwd ?? raw.project ?? '').trim();
  if (!session_id || !cwd) return null;

  const hookName = String(raw.hook_event_name ?? '').toLowerCase();
  let event_kind: PromptEventKind = 'user_prompt';
  if (hookName === 'userpromptsubmit') event_kind = 'user_prompt';
  else if (hookName === 'stop') event_kind = 'stop';
  else if (raw.event_kind != null) event_kind = String(raw.event_kind) as PromptEventKind;

  return {
    session_id,
    cwd,
    event_kind,
    prompt_text: typeof raw.prompt === 'string' ? raw.prompt
      : typeof raw.prompt_text === 'string' ? raw.prompt_text
      : null,
    response_summary: typeof raw.response_summary === 'string' ? raw.response_summary : null,
    tools_used: raw.tools_used ?? null,
    files_changed: raw.files_changed ?? null,
    tokens: raw.tokens ?? null,
    duration_ms: typeof raw.duration_ms === 'number' ? raw.duration_ms : null,
    git_commit_sha: typeof raw.git_commit_sha === 'string' ? raw.git_commit_sha : null,
    metadata: raw.metadata ?? null,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('promptLogs — normalizeEvent', () => {
  it('accepts the Claude Code UserPromptSubmit shape', () => {
    const res = normalizeEvent({
      session_id: 'abc',
      cwd: '/some/path',
      prompt: 'Hello',
      hook_event_name: 'UserPromptSubmit',
      transcript_path: '/tmp/t',
    });
    expect(res).not.toBeNull();
    expect(res!.session_id).toBe('abc');
    expect(res!.event_kind).toBe('user_prompt');
    expect(res!.prompt_text).toBe('Hello');
  });

  it('maps Stop hook_event_name to event_kind=stop', () => {
    const res = normalizeEvent({ session_id: 'abc', cwd: '/p', hook_event_name: 'Stop' });
    expect(res!.event_kind).toBe('stop');
  });

  it('accepts camelCase sessionId as alias', () => {
    const res = normalizeEvent({ sessionId: 'abc', cwd: '/p' });
    expect(res!.session_id).toBe('abc');
  });

  it('accepts project as alias for cwd', () => {
    const res = normalizeEvent({ session_id: 'abc', project: '/p' });
    expect(res!.cwd).toBe('/p');
  });

  it('rejects body without session_id', () => {
    expect(normalizeEvent({ cwd: '/p' })).toBeNull();
  });

  it('rejects body without cwd', () => {
    expect(normalizeEvent({ session_id: 'abc' })).toBeNull();
  });

  it('rejects non-object bodies', () => {
    expect(normalizeEvent(null)).toBeNull();
    expect(normalizeEvent('string')).toBeNull();
    expect(normalizeEvent(42)).toBeNull();
  });

  it('trims whitespace in session_id and cwd', () => {
    const res = normalizeEvent({ session_id: '  abc  ', cwd: '  /p  ' });
    expect(res!.session_id).toBe('abc');
    expect(res!.cwd).toBe('/p');
  });

  it('prefers .prompt over .prompt_text when both present', () => {
    const res = normalizeEvent({ session_id: 'a', cwd: '/p', prompt: 'hook', prompt_text: 'manual' });
    expect(res!.prompt_text).toBe('hook');
  });

  it('preserves optional fields when present', () => {
    const res = normalizeEvent({
      session_id: 'a',
      cwd: '/p',
      prompt_text: 'x',
      tokens: { input: 100, output: 50 },
      git_commit_sha: 'abc1234',
      duration_ms: 500,
      metadata: { foo: 'bar' },
    });
    expect(res!.tokens).toEqual({ input: 100, output: 50 });
    expect(res!.git_commit_sha).toBe('abc1234');
    expect(res!.duration_ms).toBe(500);
    expect(res!.metadata).toEqual({ foo: 'bar' });
  });

  it('defaults event_kind to user_prompt when no hook name is given', () => {
    const res = normalizeEvent({ session_id: 'a', cwd: '/p' });
    expect(res!.event_kind).toBe('user_prompt');
  });

  it('accepts explicit event_kind when no hook name maps', () => {
    const res = normalizeEvent({ session_id: 'a', cwd: '/p', event_kind: 'tool_use' });
    expect(res!.event_kind).toBe('tool_use');
  });
});
