import { useCallback, useEffect, useState } from 'react';
import { Layout, Button, LoadingSpinner, useGatewayUser } from '@boilerplate/shared/components';

// ── Types matching the backend shapes ─────────────────────────────────

interface ProjectSummary {
  cwd: string;
  prompt_count: number;
  session_count: number;
  first_seen: string;
  last_seen: string;
}

interface SessionSummary {
  session_id: string;
  cwd: string;
  prompt_count: number;
  first_prompt: string | null;
  started_at: string;
  last_activity_at: string;
}

interface EventRow {
  id: number;
  session_id: string;
  event_kind: 'user_prompt' | 'stop' | 'tool_use' | 'manual';
  cwd: string;
  prompt_text: string | null;
  response_summary: string | null;
  tools_used: unknown;
  files_changed: unknown;
  tokens: unknown;
  duration_ms: number | null;
  git_commit_sha: string | null;
  metadata: unknown;
  created_at: string;
}

interface ProjectStats {
  total_prompts: number;
  total_sessions: number;
  avg_prompts_per_session: number;
  first_seen: string | null;
  last_seen: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────

const API = '/prompt-logs/api';

async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Shortens /Users/francetv/Documents/workspace/boilerplate → boilerplate */
function shortenCwd(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : cwd;
}

// ── Main ──────────────────────────────────────────────────────────────

export default function PromptLogsApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { user, loading: authLoading } = useGatewayUser();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);

  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const rows = await fetchJson<ProjectSummary[]>('/projects');
      setProjects(rows);
      if (rows.length > 0 && selectedCwd == null) setSelectedCwd(rows[0].cwd);
    } catch (err) {
      console.error('[prompt-logs] projects load failed:', err);
    } finally { setLoadingProjects(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // On project change : fetch stats + sessions ; pick first session.
  useEffect(() => {
    if (!selectedCwd) return;
    setLoadingDetail(true);
    setSelectedSessionId(null);
    setEvents([]);
    Promise.all([
      fetchJson<ProjectStats>(`/projects/stats?cwd=${encodeURIComponent(selectedCwd)}`),
      fetchJson<SessionSummary[]>(`/sessions?cwd=${encodeURIComponent(selectedCwd)}`),
    ])
      .then(([s, sess]) => {
        setStats(s);
        setSessions(sess);
        if (sess.length > 0) setSelectedSessionId(sess[0].session_id);
      })
      .catch(err => console.error('[prompt-logs] detail load failed:', err))
      .finally(() => setLoadingDetail(false));
  }, [selectedCwd]);

  // On session change : fetch its full event list.
  useEffect(() => {
    if (!selectedSessionId) { setEvents([]); return; }
    fetchJson<EventRow[]>(`/sessions/${encodeURIComponent(selectedSessionId)}`)
      .then(setEvents)
      .catch(err => console.error('[prompt-logs] session events load failed:', err));
  }, [selectedSessionId]);

  if (authLoading) {
    return (
      <Layout appId="prompt-logs" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem' }}><LoadingSpinner message="Chargement..." /></div>
      </Layout>
    );
  }
  if (!user?.isAdmin) {
    return (
      <Layout appId="prompt-logs" variant="full-width" onNavigate={onNavigate}>
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h1>403</h1>
          <p>Cette page est réservée aux administrateurs.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout appId="prompt-logs" variant="full-width" onNavigate={onNavigate}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        height: 'calc(100vh - 48px)',
        fontFamily: 'var(--font-mono)',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
      }}>
        {/* ─── Sidebar : projects (cwd) ─── */}
        <aside style={{
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--bg-secondary, var(--bg-primary))',
        }}>
          <div style={{
            padding: 'var(--spacing-sm) var(--spacing-md)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          }}>
            <h1 style={{ margin: 0, fontSize: 'var(--font-size-md)', color: 'var(--accent-primary)' }}>
              🪝 Logs Prompts
            </h1>
            <Button variant="secondary" onClick={loadProjects} disabled={loadingProjects}>
              {loadingProjects ? '…' : '🔄'}
            </Button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingProjects ? (
              <div style={{ padding: 'var(--spacing-md)' }}><LoadingSpinner message="…" /></div>
            ) : projects.length === 0 ? (
              <EmptyState />
            ) : (
              projects.map(p => {
                const active = p.cwd === selectedCwd;
                return (
                  <button
                    key={p.cwd}
                    onClick={() => setSelectedCwd(p.cwd)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: 'var(--spacing-sm) var(--spacing-md)',
                      background: active ? 'rgba(102,126,234,0.12)' : 'transparent',
                      borderLeft: active ? '3px solid var(--accent-primary)' : '3px solid transparent',
                      border: 'none', borderBottom: '1px solid var(--border-color)',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      color: 'inherit',
                    }}
                    title={p.cwd}
                  >
                    <div style={{ fontWeight: 600, fontSize: 13, color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                      {shortenCwd(p.cwd)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', opacity: 0.7, marginTop: 2, wordBreak: 'break-all' }}>
                      {p.cwd}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                      <strong>{p.prompt_count}</strong> prompt{p.prompt_count > 1 ? 's' : ''} · <strong>{p.session_count}</strong> session{p.session_count > 1 ? 's' : ''}
                      <br />dernière activité {formatDate(p.last_seen)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ─── Main : session timeline ─── */}
        <main style={{ overflowY: 'auto', padding: 'var(--spacing-md) var(--spacing-lg)' }}>
          {!selectedCwd ? (
            <EmptyState />
          ) : (
            <ProjectView
              cwd={selectedCwd}
              stats={stats}
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              onSelectSession={setSelectedSessionId}
              events={events}
              loading={loadingDetail}
            />
          )}
        </main>
      </div>
    </Layout>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      padding: 'var(--spacing-lg)',
      fontSize: 'var(--font-size-sm)',
      color: 'var(--text-secondary)',
      lineHeight: 1.6,
    }}>
      <h2 style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-md)' }}>
        🪝 Aucun log pour l'instant
      </h2>
      <p>Pour commencer à logger tes prompts Claude Code, configure le hook <code>UserPromptSubmit</code> dans <code>~/.claude/settings.json</code> :</p>
      <pre style={{
        background: 'var(--bg-secondary, rgba(128,128,128,0.08))',
        padding: 'var(--spacing-sm)',
        fontSize: 11, lineHeight: 1.5,
        borderRadius: 'var(--radius-sm)',
        border: '1px solid var(--border-color)',
        overflow: 'auto',
      }}>{`{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST http://localhost:3000/prompt-logs/api/events -H 'Content-Type: application/json' -d @-"
      }]
    }]
  }
}`}</pre>
      <p>Redémarre Claude Code, envoie un prompt, reviens ici et clique 🔄.</p>
      <p style={{ fontSize: 11, opacity: 0.7 }}>
        Doc complète : <code>apps/platform/servers/unified/src/modules/promptLogs/HOOK.md</code>
      </p>
    </div>
  );
}

interface ProjectViewProps {
  cwd: string;
  stats: ProjectStats | null;
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  events: EventRow[];
  loading: boolean;
}

function ProjectView({ cwd, stats, sessions, selectedSessionId, onSelectSession, events, loading }: ProjectViewProps) {
  if (loading && sessions.length === 0) return <LoadingSpinner message="Chargement…" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
      {/* Header + stats */}
      <header>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>cwd</div>
        <h2 style={{ margin: 0, fontSize: 'var(--font-size-lg)', wordBreak: 'break-all' }}>
          {cwd}
        </h2>
        {stats && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 'var(--spacing-sm)',
            marginTop: 'var(--spacing-sm)',
          }}>
            <StatCard label="Total prompts" value={stats.total_prompts} />
            <StatCard label="Sessions" value={stats.total_sessions} />
            <StatCard label="Prompts / session (moy)" value={stats.avg_prompts_per_session} />
            <StatCard label="Premier prompt" value={stats.first_seen ? formatDate(stats.first_seen) : '—'} />
            <StatCard label="Dernière activité" value={stats.last_seen ? formatDate(stats.last_seen) : '—'} />
          </div>
        )}
      </header>

      {/* Sessions list */}
      <section>
        <h3 style={{ margin: '0 0 var(--spacing-xs)', fontSize: 'var(--font-size-md)', color: 'var(--accent-primary)' }}>
          💬 Sessions ({sessions.length})
        </h3>
        {sessions.length === 0 ? (
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)' }}>Aucune session pour ce projet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
            {sessions.map(s => {
              const active = s.session_id === selectedSessionId;
              return (
                <button
                  key={s.session_id}
                  onClick={() => onSelectSession(s.session_id)}
                  style={{
                    display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-start',
                    padding: 'var(--spacing-xs) var(--spacing-sm)',
                    background: active ? 'rgba(102,126,234,0.1)' : 'transparent',
                    border: '1px solid var(--border-color)',
                    borderLeft: active ? '3px solid var(--accent-primary)' : '3px solid transparent',
                    borderRadius: 'var(--radius-sm)',
                    textAlign: 'left', cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    color: 'inherit',
                  }}
                  title={`Session ${s.session_id}`}
                >
                  <span style={{
                    padding: '2px 8px', background: 'var(--accent-primary)', color: '#000',
                    fontSize: 11, fontWeight: 600, borderRadius: 2, minWidth: 40, textAlign: 'center',
                  }}>
                    {s.prompt_count}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.first_prompt ? truncate(s.first_prompt, 120) : <em>(session sans premier prompt)</em>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {formatDate(s.started_at)} → {formatDate(s.last_activity_at)} · <code>{s.session_id.slice(0, 12)}</code>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Events timeline for the selected session */}
      {selectedSessionId && (
        <section>
          <h3 style={{ margin: '0 0 var(--spacing-xs)', fontSize: 'var(--font-size-md)', color: 'var(--accent-primary)' }}>
            📜 Timeline — session {selectedSessionId.slice(0, 12)} ({events.length} événement{events.length > 1 ? 's' : ''})
          </h3>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--spacing-xs)' }}>
            {events.map(e => <EventCard key={e.id} event={e} />)}
          </ol>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      padding: 'var(--spacing-xs) var(--spacing-sm)',
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-secondary, rgba(128,128,128,0.04))',
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--font-size-md)', color: 'var(--accent-primary)', fontWeight: 600, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function EventCard({ event }: { event: EventRow }) {
  const kindIcon = event.event_kind === 'user_prompt' ? '👤'
    : event.event_kind === 'stop' ? '🛑'
    : event.event_kind === 'tool_use' ? '🔧'
    : '•';
  return (
    <li style={{
      padding: 'var(--spacing-xs) var(--spacing-sm)',
      border: '1px solid var(--border-color)',
      borderLeft: '3px solid var(--accent-primary)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg-secondary, rgba(128,128,128,0.04))',
      fontFamily: 'var(--font-mono)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
        <span>{kindIcon}</span>
        <strong style={{ color: 'var(--accent-primary)' }}>{event.event_kind}</strong>
        <span>·</span>
        <span>{formatTime(event.created_at)}</span>
        {event.git_commit_sha && (
          <>
            <span>·</span>
            <code style={{ opacity: 0.7 }}>{event.git_commit_sha.slice(0, 7)}</code>
          </>
        )}
        {event.duration_ms != null && (
          <>
            <span>·</span>
            <span>{event.duration_ms} ms</span>
          </>
        )}
      </div>
      {event.prompt_text && (
        <pre style={{
          margin: 'var(--spacing-xs) 0 0',
          padding: 'var(--spacing-xs)',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12, lineHeight: 1.4,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 400, overflow: 'auto',
        }}>{event.prompt_text}</pre>
      )}
      {event.response_summary && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
          ↳ {truncate(event.response_summary, 240)}
        </div>
      )}
    </li>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
