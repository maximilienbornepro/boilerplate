// Settings modal for the auto-import feature.
// Two surfaces :
//   1. User-level — master kill-switch + which source integrations
//      the cron is allowed to fetch from (Fathom / Otter / Outlook /
//      Gmail / Slack).
//   2. Per-document opt-in list — a toggle next to each suivitess
//      saying "this doc accepts auto-routed content from the bot".
//
// The IMPORT itself is cross-doc (the bulk modal on the suivitess
// LIST page) : the AI decides which subscribed doc each subject
// lands in.

import { useEffect, useState } from 'react';
import { Modal, Button, LoadingSpinner, Card } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { Document } from '../../types';
import type { AutoImportSource, UserAutoImportSettings } from '../../services/api';
import styles from './AutoImportSettings.module.css';

const SOURCES: Array<{ value: AutoImportSource; label: string }> = [
  { value: 'fathom',  label: 'Fathom'  },
  { value: 'otter',   label: 'Otter'   },
  { value: 'outlook', label: 'Outlook' },
  { value: 'gmail',   label: 'Gmail'   },
  { value: 'slack',   label: 'Slack'   },
];

interface Props {
  documents: Document[];
  onClose: () => void;
}

export function AutoImportSettings({ documents, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [savingUser, setSavingUser] = useState(false);
  const [savingDocId, setSavingDocId] = useState<string | null>(null);
  const [userSettings, setUserSettings] = useState<UserAutoImportSettings>({
    masterDisabled: false,
    sources: [],
    lastRunAt: null,
    lastError: null,
    consecutiveErrors: 0,
  });
  const [docOptIn, setDocOptIn] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, ...docStates] = await Promise.all([
          api.getAutoImportSettings(),
          ...documents.map(d =>
            api.getDocumentAutoImportEnabled(d.id).then(r => ({ id: d.id, enabled: r.enabled }))
          ),
        ]);
        if (cancelled) return;
        setUserSettings(s);
        const map: Record<string, boolean> = {};
        for (const e of docStates as Array<{ id: string; enabled: boolean }>) {
          map[e.id] = e.enabled;
        }
        setDocOptIn(map);
      } catch { /* empty state ok */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [documents]);

  const updateUser = async (patch: Partial<UserAutoImportSettings>) => {
    setSavingUser(true);
    const prev = userSettings;
    const next = { ...prev, ...patch };
    setUserSettings(next); // optimistic
    try {
      const fresh = await api.setAutoImportSettings({
        masterDisabled: patch.masterDisabled,
        sources: patch.sources,
      });
      setUserSettings(fresh);
    } catch {
      setUserSettings(prev);
    } finally {
      setSavingUser(false);
    }
  };

  const toggleSource = (source: AutoImportSource) => {
    const has = userSettings.sources.includes(source);
    const next = has
      ? userSettings.sources.filter(s => s !== source)
      : [...userSettings.sources, source];
    void updateUser({ sources: next });
  };

  const toggleDoc = async (docId: string) => {
    const next = !docOptIn[docId];
    setSavingDocId(docId);
    setDocOptIn(prev => ({ ...prev, [docId]: next })); // optimistic
    try {
      await api.setDocumentAutoImportEnabled(docId, next);
    } catch {
      setDocOptIn(prev => ({ ...prev, [docId]: !next })); // rollback
    } finally {
      setSavingDocId(null);
    }
  };

  const masterEnabled = !userSettings.masterDisabled;

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
                    Maître. Coupe TOUT en un clic peu importe les sources et docs subscribed.
                    L'IA tourne toutes les heures et range les propositions dans la boîte de réception.
                  </span>
                </div>
                <label className={styles.bigSwitch}>
                  <input
                    type="checkbox"
                    checked={masterEnabled}
                    onChange={e => updateUser({ masterDisabled: !e.target.checked })}
                    disabled={savingUser}
                  />
                  <span className={styles.bigSwitchTrack} />
                </label>
              </div>
              <div className={styles.masterStatus}>
                {masterEnabled
                  ? <span className={styles.statusOn}>● Actif</span>
                  : <span className={styles.statusOff}>○ Désactivé · les sources et opt-ins par doc sont ignorés</span>}
                {userSettings.lastRunAt && (
                  <span className={styles.lastRun}>
                    · Dernier run : {new Date(userSettings.lastRunAt).toLocaleString('fr-FR', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                )}
                {userSettings.lastError && (
                  <span className={styles.lastError}> · ⚠ {userSettings.lastError.slice(0, 80)}</span>
                )}
              </div>
            </div>

            <hr className={styles.divider} />

            {/* Sources at user level */}
            <h3 className={styles.sectionTitle}>Sources à analyser (intégrations utilisateur)</h3>
            <p className={styles.sectionHint}>
              Quels providers le bot va-t-il interroger pour récupérer du nouveau ?
              Les intégrations sont configurées dans tes connecteurs habituels — coche
              ici lesquelles servent l'auto-import.
            </p>
            <div className={styles.sourcesRow}>
              {SOURCES.map(s => (
                <label key={s.value} className={styles.sourceChip}>
                  <input
                    type="checkbox"
                    checked={userSettings.sources.includes(s.value)}
                    onChange={() => toggleSource(s.value)}
                    disabled={savingUser || !masterEnabled}
                  />
                  <span>{s.label}</span>
                </label>
              ))}
            </div>

            <hr className={styles.divider} />

            {/* Per-doc opt-in */}
            <h3 className={styles.sectionTitle}>Suivitess candidats au routage</h3>
            <p className={styles.sectionHint}>
              Coche les suivitess que l'IA peut cibler quand elle analyse une nouvelle source.
              Ceux qui ne sont pas cochés sont invisibles pour l'auto-import (le bot peut quand
              même router manuellement vers eux via la modale d'import classique).
            </p>
            <div className={styles.docList}>
              {documents.length === 0 && (
                <div className={styles.emptyDocs}>Aucun document. Crée-en un d'abord.</div>
              )}
              {documents.map(doc => {
                const optedIn = docOptIn[doc.id] === true;
                const isSaving = savingDocId === doc.id;
                return (
                  <Card
                    key={doc.id}
                    variant="compact"
                    selected={optedIn}
                    className={styles.docCard}
                  >
                    <div className={styles.docHeader}>
                      <strong className={styles.docTitle}>{doc.title}</strong>
                      <label className={styles.smallSwitch}>
                        <input
                          type="checkbox"
                          checked={optedIn}
                          onChange={() => void toggleDoc(doc.id)}
                          disabled={isSaving || !masterEnabled}
                        />
                        <span className={styles.smallSwitchTrack} />
                      </label>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        <div className={styles.footer}>
          <span className={styles.footerHint}>
            Le scheduler tourne toutes les heures. Les propositions atterrissent dans
            la <strong>Boîte de réception</strong> en haut à droite, en attente de validation.
          </span>
          <Button variant="primary" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </Modal>
  );
}
