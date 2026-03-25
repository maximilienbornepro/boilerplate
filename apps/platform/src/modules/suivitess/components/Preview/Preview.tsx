import { useState } from 'react';
import type { Change } from '../../types';
import styles from './Preview.module.css';

interface Props {
  changes: Change[];
  summary: string;
  finalContent: string;
  isUpdating: boolean;
  onUpdate: () => void;
  onBack: () => void;
}

export function Preview({ changes, summary, finalContent, isUpdating, onUpdate, onBack }: Props) {
  const [activeTab, setActiveTab] = useState<'summary' | 'changes' | 'full'>('summary');

  return (
    <div className={styles.container}>
      <h2>Previsualisation des modifications</h2>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'summary' ? styles.active : ''}`}
          onClick={() => setActiveTab('summary')}
        >
          Resume
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'changes' ? styles.active : ''}`}
          onClick={() => setActiveTab('changes')}
        >
          Changements ({changes.length})
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'full' ? styles.active : ''}`}
          onClick={() => setActiveTab('full')}
        >
          Document complet
        </button>
      </div>

      <div className={styles.content}>
        {activeTab === 'summary' && (
          <div className={styles.summary}>
            <h3>Resume des changements</h3>
            <div className={styles.markdownPreview}>
              <pre>{summary}</pre>
            </div>
          </div>
        )}

        {activeTab === 'changes' && (
          <div className={styles.changesList}>
            {changes.length === 0 ? (
              <p className={styles.noChanges}>Aucune modification detectee</p>
            ) : (
              changes.map((change, idx) => (
                <div key={idx} className={`${styles.changeCard} ${styles[change.type]}`}>
                  <div className={styles.changeHeader}>
                    <span className={styles.changeType}>
                      {change.type === 'new' && 'Nouveau'}
                      {change.type === 'modified' && 'Modifie'}
                      {change.type === 'status_change' && 'Statut'}
                    </span>
                    <span className={styles.changeSection}>{change.section}</span>
                  </div>
                  <div className={styles.changeSubject}>{change.subject}</div>
                  <div className={styles.changeDetails}>{change.details}</div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'full' && (
          <div className={styles.fullDocument}>
            <pre>{finalContent}</pre>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button className={styles.backBtn} onClick={onBack} disabled={isUpdating}>
          Retour a la revue
        </button>
        <button className={styles.updateBtn} onClick={onUpdate} disabled={isUpdating}>
          {isUpdating ? (
            <>
              <span className={styles.spinner}></span>
              Mise a jour en cours...
            </>
          ) : (
            'Sauvegarder'
          )}
        </button>
      </div>
    </div>
  );
}
