import { useAuth } from '../../context/AuthContext';
import { CreditBadge } from './CreditBadge';
import { ModuleRecentBlock, type SubItem } from './ModuleRecentBlock';
import { fetchDocuments, fetchDocument } from '../../../suivitess/services/api';
import { fetchPlannings, fetchTasks } from '../../../roadmap/services/api';
import { fetchBoards, fetchTasksForBoard } from '../../../delivery/services/api';
import { fetchLeaves } from '../../../conges/services/api';
import styles from './Dashboard.module.css';

interface Props {
  onNavigate?: (path: string) => void;
}

// Module icons (smaller, monocolor for the dashboard)
const Icons = {
  suivitess: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  roadmap: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  ),
  delivery: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" />
    </svg>
  ),
  conges: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
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
    has: (mod: string) => isAdmin || userPerms.has(mod),
  };

  // ─── Fetch leaves (conges) for next 30 days ───
  const fetchUpcomingLeaves = () => {
    const today = new Date();
    const in30Days = new Date(today);
    in30Days.setDate(in30Days.getDate() + 30);
    return fetchLeaves(today.toISOString().slice(0, 10), in30Days.toISOString().slice(0, 10));
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
            fetchSubItems={async (item) => {
              const doc = await fetchDocument(String(item.id));
              if (!doc?.sections) return [];
              // Flatten all subjects + sort by updated_at DESC
              const all: Array<{ title: string; updated_at: string; sectionId: string }> = [];
              for (const sec of doc.sections) {
                for (const sub of sec.subjects) {
                  all.push({ title: sub.title, updated_at: sub.updated_at, sectionId: sec.id });
                }
              }
              all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
              return all.slice(0, 3).map<SubItem>(s => ({
                label: s.title,
                date: s.updated_at,
                href: `/suivitess/${item.id}?section=${s.sectionId}`,
              }));
            }}
            seeAllHref="/suivitess"
            createHref="/suivitess?create=1"
            createLabel="+ Nouvelle review"
            emptyMessage="Aucune review pour le moment."
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
            fetchSubItems={async (item) => {
              const tasks = await fetchTasks(String(item.id));
              return tasks
                .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
                .slice(0, 3)
                .map<SubItem>(t => ({
                  label: t.name,
                  date: t.updatedAt || t.createdAt,
                  href: `/roadmap/${item.id}?task=${t.id}`,
                }));
            }}
            seeAllHref="/roadmap"
            createHref="/roadmap?create=1"
            createLabel="+ Nouveau planning"
            emptyMessage="Aucune roadmap pour le moment."
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
            })}
            fetchSubItems={async (item) => {
              const tasks = await fetchTasksForBoard(String(item.id));
              return tasks
                .slice(0, 3)
                .map<SubItem>(t => ({
                  label: t.title,
                  href: `/delivery/${item.id}`,
                }));
            }}
            seeAllHref="/delivery"
            createHref="/delivery?create=1"
            createLabel="+ Nouveau board"
            emptyMessage="Aucun board pour le moment."
            onNavigate={onNavigate}
          />
        )}

        {perms.has('conges') && (
          <ModuleRecentBlock
            appId="conges"
            title="Conges (a venir)"
            color={COLORS.conges}
            icon={Icons.conges}
            fetchItems={fetchUpcomingLeaves}
            mapItem={(l) => ({
              id: l.id,
              title: `${l.startDate}${l.endDate !== l.startDate ? ` → ${l.endDate}` : ''}`,
              date: l.startDate,
              href: '/conges',
              meta: l.reason,
            })}
            seeAllHref="/conges"
            createHref="/conges?create=1"
            createLabel="+ Poser un conge"
            emptyMessage="Aucun conge a venir."
            onNavigate={onNavigate}
          />
        )}
      </div>
    </div>
  );
}
