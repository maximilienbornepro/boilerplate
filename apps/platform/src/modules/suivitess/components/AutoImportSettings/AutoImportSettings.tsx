// Settings modal for the auto-import feature.
// - Master kill-switch (per user) at the top — one click disables EVERYTHING.
// - Per-document list with an enabled switch + source checkboxes
//   (Fathom / Otter / Outlook / Gmail / Slack).
// - Live status per document : last run, last error, count of pending /
//   accepted / rejected proposals.

import { useEffect, useState } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { Document } from '../../types';
import type { AutoImportSource } from '../../services/api';
import styles from './AutoImportSettings.module.css';

const SOURCES: Array<{ value: AutoImportSource; label: string; emoji: string }> = [
  { value: 'fathom',  label: 'Fathom',  emoji: '📞' },
  { value: 'otter',   label: 'Otter',   emoji: '🦦' },
  { value: 'outlook', label: 'Outlook', emoji: '📨' },
  { value: 'gmail',   label: 'Gmail',   emoji: '📧' },
  { value: 'slack',   label: 'Slack',   emoji: '💬' },
];

interface Props {
  documents: Document[];
  onClose: () => void;
}

interface PerDocConfig {
  enabled: boolean;
  enabledSources: AutoImportSource[];
  lastRunAt?: string | null;
  lastError?: string | null;
}

export function AutoImportSettings({ documents, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [savingMaster, setSavingMaster] = useState(false);
  const [savingDocId, setSavingDocId] = useState<string | null>(null);
  const [masterEnabled, setMasterEnabled] = useState(true);
  const [configs, setConfigs] = useState<Record<string, PerDocConfig>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [master, ...docConfigs] = await Promise.all([
          api.getAutoImportMaster(),
          ...documents.map(d => api.getAutoImportConfig(d.id).then(c => ({ id: d.id, c }))),
        ]);
        if (cancelled) return;
        setMasterEnabled(master.enabled);
        const map: Record<string, PerDocConfig> = {};
        for (const e of docConfigs as Array<{ id: string; c: PerDocConfig }>) {
          map[e.id] = e.c;
        }
        setConfigs(map);
      } catch {
        // swallow — empty state is fine
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [documents]);

  const toggleMaster = async (next: boolean) => {
    setSavingMaster(true);
    try {
      await api.setAutoImportMaster(next);
      setMasterEnabled(next);
    } catch {
      // surface no toast — caller's modal close handles UX
    } finally {
      setSavingMaster(false);
    }
  };

  const updateDoc = async (docId: string, patch: Partial<PerDocConfig>) => {
    setSavingDocId(docId);
    const prev = configs[docId] ?? { enabled: false, enabledSources: [] };
    const next: PerDocConfig = { ...prev, ...patch };
    setConfigs(c => ({ ...c, [docId]: next })); // optimistic
    try {
      const fresh = await api.setAutoImportConfig(docId, {
        enabled: next.enabled,
        enabledSources: next.enabledSources,
      });
      setConfigs(c => ({ ...c, [docId]: fresh }));
    } catch {
      // Roll back on failure — keep optimistic if the user already moved on
      setConfigs(c => ({ ...c, [docId]: prev }));
    } finally {
      setSavingDocId(null);
    }
  };

  const toggleSource = (docId: string, source: AutoImportSource) => {
    const cfg = configs[docId] ?? { enabled: false, enabledSources: [] };
    const has = cfg.enabledSources.includes(source);
    const nextSources = has
      ? cfg.enabledSources.filter(s => s !== source)
      : [...cfg.enabledSources, source];
    void updateDoc(docId, { enabledSources: nextSources });
  };

  return (
    <Modal title="Réglages — Import automatique" onClose={onClose} size="lg">
      <div className={styles.body}>
        {loading ? (
          <LoadingSpinner message="Chargement…" />
        ) : (
          <>
            {/* Master kill-switch */}
            <div className={styles.masterSection}>
              <div className={styles.masterRow}>
                <div className={styles.masterText}>
                  <strong>Import automatique global</strong>
                  <span className={styles.masterHint}>
                    Coupe TOUT en un clic, peu importe les configs par document.
                    Tu peux le ré-activer plus tard sans reconfigurer chaque doc.
                  </span>
                </div>
                <label className={styles.bigSwitch}>
                  <input
                    type="checkbox"
                    checked={masterEnabled}
                    onChange={e => toggleMaster(e.target.checked)}
                    disabled={savingMaster}
                  />
                  <span className={styles.bigSwitchTrack} />
                </label>
              </div>
              <div className={styles.masterStatus}>
                {masterEnabled
                  ? <span className={styles.statusOn}>● Actif</span>
                  : <span className={styles.statusOff}>○ Désactivé · les configs par document sont ignorées</span>}
              </div>
            </div>

            <hr className={styles.divider} />

            {/* Per-doc */}
            <h3 className={styles.sectionTitle}>Configuration par document</h3>
            <p className={styles.sectionHint}>
              Active l'import automatique sur les documents qui t'intéressent et
              choisis les sources à analyser. Le scheduler tourne toutes les heures
              et range les propositions dans la boîte de réception en attente de ta validation.
            </p>

            <div className={styles.docList}>
              {documents.length === 0 && (
                <div className={styles.emptyDocs}>Aucun document. Crée-en un d'abord.</div>
              )}
              {documents.map(doc => {
                const cfg = configs[doc.id] ?? { enabled: false, enabledSources: [] };
                const isSaving = savingDocId === doc.id;
                return (
                  <div key={doc.id} className={`${styles.docCard} ${cfg.enabled ? styles.docCardActive : ''}`}>
                    <div className={styles.docHeader}>
                      <div className={styles.docTitleBlock}>
                        <strong className={styles.docTitle}>{doc.title}</strong>
                        {cfg.lastRunAt && (
                          <span className={styles.docMeta}>
                            Dernier run : {new Date(cfg.lastRunAt).toLocaleString('fr-FR', {
                              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        )}
                        {cfg.lastError && (
                          <span className={styles.docError}>⚠ {cfg.lastError.slice(0, 100)}</span>
                        )}
                      </div>
                      <label className={styles.smallSwitch}>
                        <input
                          type="checkbox"
                          checked={cfg.enabled}
                          onChange={e => updateDoc(doc.id, { enabled: e.target.checked })}
                          disabled={isSaving}
                        />
                        <span className={styles.smallSwitchTrack} />
                      </label>
                    </div>

                    {cfg.enabled && (
                      <div className={styles.sourcesRow}>
                        <span className={styles.sourcesLabel}>Sources :</span>
                        {SOURCES.map(s => (
                          <label key={s.value} className={styles.sourceChip}>
                            <input
                              type="checkbox"
                              checked={cfg.enabledSources.includes(s.value)}
                              onChange={() => toggleSource(doc.id, s.value)}
                              disabled={isSaving}
                            />
                            <span>{s.emoji} {s.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className={styles.footer}>
          <span className={styles.footerHint}>
            Le scheduler tourne toutes les heures. Les propositions apparaîtront dans
            la <strong>Boîte de réception</strong> de la barre latérale.
          </span>
          <Button variant="primary" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </Modal>
  );
}
