import { useAuth } from '../../context/AuthContext';
import { CreditBadge } from './CreditBadge';
import { ModuleRecentBlock } from './ModuleRecentBlock';
import { fetchDocuments, fetchDocument } from '../../../suivitess/services/api';
import { fetchPlannings, fetchTasks } from '../../../roadmap/services/api';
import { fetchBoards, fetchTasksForBoard } from '../../../delivery/services/api';
import { fetchLeaves, fetchMembers } from '../../../conges/services/api';
import { getLeaveReasonInfo } from '../../../conges/types';
import type { Leave, Member } from '../../../conges/types';
import { normalizeStatus } from '../../../roadmap/utils/statusColors';
import styles from './Dashboard.module.css';

interface Props {
  onNavigate?: (path: string) => void;
}

// Module icons — same as LandingPage for visual consistency
const Icons = {
  conges: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  roadmap: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
  suivitess: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  delivery: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  ),
};

const COLORS = {
  suivitess: '#10b981',
  roadmap: '#8b5cf6',
  delivery: '#ff9800',
  conges: '#ec4899',
};

export function Dashboard({ onNavigate }: Props) {
  const { user } = useAuth();
  const userPerms = new Set(user?.permissions || []);
  const isAdmin = user?.isAdmin ?? false;
  const perms = {
    has: (mod: string) => userPerms.has(mod),
  };

  // ─── Fetch leaves (conges) for next 30 days, with member names attached ───
  type LeaveWithMember = Leave & { memberName: string };
  const fetchUpcomingLeaves = async (): Promise<LeaveWithMember[]> => {
    const today = new Date();
    const in30Days = new Date(today);
    in30Days.setDate(in30Days.getDate() + 30);
    const [leaves, members] = await Promise.all([
      fetchLeaves(today.toISOString().slice(0, 10), in30Days.toISOString().slice(0, 10)),
      fetchMembers().catch(() => [] as Member[]),
    ]);
    const byId = new Map(members.map(m => [m.id, m]));
    return leaves.map(l => {
      const member = byId.get(l.memberId);
      // Members only expose an email — derive a readable name from it.
      const fromEmail = member?.email?.split('@')[0]?.replace(/[._-]+/g, ' ').trim() || '';
      const memberName = fromEmail
        ? fromEmail.replace(/\b\w/g, c => c.toUpperCase())
        : '?';
      return { ...l, memberName };
    });
  };

  return (
    <div className={styles.dashboard}>
      <div className={styles.dashboardHeader}>
        <div>
          <h2 className={styles.dashboardTitle}>Tableau de bord</h2>
        </div>
        <CreditBadge onNavigate={onNavigate} />
      </div>

      {/* === Recent items per module === */}
      <div className={styles.recentGrid}>
        {perms.has('conges') && (
          <ModuleRecentBlock
            appId="conges"
            title="Congés"
            color={COLORS.conges}
            icon={Icons.conges}
            fetchItems={fetchUpcomingLeaves}
            mapItem={(l) => {
              const fmtFull = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
              const fmtShort = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
              const fmtDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric' });
              const sameYear = l.startDate.substring(0, 4) === l.endDate.substring(0, 4);
              const sameMonth = l.startDate.substring(0, 7) === l.endDate.substring(0, 7);
              let dateRange: string;
              if (l.endDate === l.startDate) {
                dateRange = fmtFull(l.startDate);
              } else if (sameMonth) {
                dateRange = `${fmtDay(l.startDate)} → ${fmtFull(l.endDate)}`;
              } else if (sameYear) {
                dateRange = `${fmtShort(l.startDate)} → ${fmtFull(l.endDate)}`;
              } else {
                dateRange = `${fmtFull(l.startDate)} → ${fmtFull(l.endDate)}`;
              }
              const title = l.memberName && l.memberName !== '?' ? `${l.memberName} · ${dateRange}` : dateRange;
              return { id: l.id, title, date: l.startDate, href: '/conges', meta: getLeaveReasonInfo(l.reason).label };
            }}
            sortDirection="asc"
            seeAllHref="/conges"
            createHref="/conges?create=1"
            createLabel="+ Poser un congé"
            emptyMessage="Aucun congé à venir."
            onNavigate={onNavigate}
          />
        )}

        {perms.has('roadmap') && (
          <ModuleRecentBlock
            appId="roadmap"
            title="Roadmap"
            color={COLORS.roadmap}
            icon={Icons.roadmap}
            fetchItems={fetchPlannings}
            mapItem={(p) => ({
              id: p.id,
              title: p.name,
              date: p.updatedAt || p.createdAt,
              href: `/roadmap/${p.id}`,
              meta: p.description || undefined,
            })}
            computeMeta={async (item) => {
              try {
                const tasks = await fetchTasks(String(item.id));
                const inProgress = tasks.filter(t => normalizeStatus(t.status) === 'in_progress').length;
                return inProgress > 0 ? `${inProgress} tâche${inProgress > 1 ? 's' : ''} en cours` : null;
              } catch {
                return null;
              }
            }}
            seeAllHref="/roadmap"
            createHref="/roadmap?create=1"
            createLabel="+ Nouveau planning"
            emptyMessage="Aucune roadmap pour le moment."
            onNavigate={onNavigate}
          />
        )}

        {perms.has('suivitess') && (
          <ModuleRecentBlock
            appId="suivitess"
            title="SuiviTess"
            color={COLORS.suivitess}
            icon={Icons.suivitess}
            fetchItems={fetchDocuments}
            mapItem={(d: { id: string; title: string; description?: string | null; updated_at?: string; updatedAt?: string }) => ({
              id: d.id,
              title: d.title,
              date: (d.updated_at || d.updatedAt || '') as string,
              href: `/suivitess/${d.id}`,
              meta: d.description ? d.description.slice(0, 40) : undefined,
            })}
            computeMeta={async (item) => {
              try {
                const doc = await fetchDocument(String(item.id));
                if (!doc?.sections) return null;
                let enCours = 0;
                let bloque = 0;
                for (const sec of doc.sections) {
                  for (const sub of sec.subjects) {
                    const s = (sub.status || '').toLowerCase();
                    if (s.includes('en cours')) enCours++;
                    else if (s.includes('bloqué') || s.includes('bloque')) bloque++;
                  }
                }
                const parts: string[] = [];
                if (enCours > 0) parts.push(`${enCours} en cours`);
                if (bloque > 0) parts.push(`${bloque} bloqué${bloque > 1 ? 's' : ''}`);
                return parts.length > 0 ? parts.join(' · ') : null;
              } catch {
                return null;
              }
            }}
            seeAllHref="/suivitess"
            createHref="/suivitess?create=1"
            createLabel="+ Nouvelle review"
            emptyMessage="Aucune review pour le moment."
            onNavigate={onNavigate}
          />
        )}

        {perms.has('delivery') && (
          <ModuleRecentBlock
            appId="delivery"
            title="Delivery"
            color={COLORS.delivery}
            icon={Icons.delivery}
            fetchItems={fetchBoards}
            mapItem={(b: { id: string; name: string; description: string | null; boardType: string; startDate: string | null; updatedAt?: string; createdAt?: string }) => ({
              id: b.id,
              title: b.name,
              date: (b.updatedAt || b.createdAt || b.startDate || '') as string,
              href: `/delivery/${b.id}`,
              meta: b.boardType === 'agile' ? 'Agile' : 'Calendaire',
              metaTag: true,
            })}
            computeMeta={async (item) => {
              try {
                const tasks = await fetchTasksForBoard(String(item.id));
                const inProgress = tasks.filter(t => t.status === 'in_progress').length;
                return inProgress > 0 ? `${inProgress} en cours` : null;
              } catch {
                return null;
              }
            }}
            seeAllHref="/delivery"
            createHref="/delivery?create=1"
            createLabel="+ Nouveau board"
            emptyMessage="Aucun board pour le moment."
            onNavigate={onNavigate}
          />
        )}

      </div>
    </div>
  );
}
