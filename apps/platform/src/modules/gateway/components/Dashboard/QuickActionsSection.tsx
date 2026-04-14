import type { ReactNode } from 'react';
import styles from './Dashboard.module.css';

interface Action {
  label: string;
  href: string;
  primary?: boolean;
}

interface ModuleActions {
  appId: string;
  title: string;
  color: string;
  icon: ReactNode;
  actions: Action[];
}

interface Props {
  groups: ModuleActions[];
  onNavigate?: (path: string) => void;
}

export function QuickActionsSection({ groups, onNavigate }: Props) {
  const navigate = (path: string) => {
    if (onNavigate) onNavigate(path);
    else window.location.href = path;
  };

  return (
    <div className={styles.actionsSection}>
      <h3 className={styles.actionsTitle}>Raccourcis</h3>
      <div className={styles.actionsGrid}>
        {groups.map(g => (
          <div key={g.appId} className={styles.actionGroup}>
            <div className={styles.actionGroupHeader}>
              <span className={styles.moduleIcon} style={{ background: g.color, color: '#fff' }}>{g.icon}</span>
              <span className={styles.actionGroupTitle}>{g.title}</span>
            </div>
            <div className={styles.actionList}>
              {g.actions.map(a => (
                <button
                  key={a.label}
                  className={`${styles.actionBtn} ${a.primary ? styles.actionBtnPrimary : ''}`}
                  onClick={() => navigate(a.href)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
