import { useState, useEffect, useCallback } from 'react';
import { Modal, Button } from '@boilerplate/shared/components';
import { fetchJiraProjects, fetchJiraSprints } from '../../../delivery/services/api';
import type { JiraProject, JiraSprint } from '../../../delivery/services/api';
import { recordJiraProjectUsage, sortJiraProjectsByUsage } from '../../../delivery/services/jiraProjectUsage';
import styles from './SubjectAnalysisModal.module.css';

interface Suggestion {
  subjectId: string;
  subjectTitle: string;
  needsAction: boolean;
  reason: string;
  suggestedTitle: string;
  suggestedDescription: string;
}

interface RoadmapPlanning {
  id: string;
  name: string;
}

interface JiraDynamicField {
  id: string;
  name: string;
  required: boolean;
  type: string;
  items: string | null;
  allowedValues: Array<{ id: string; label: string }> | null;
}

interface SubjectConfig {
  // Jira config
  createJira: boolean;
  jiraProject: string;
  jiraSprint: string;
  jiraIssueType: string;
  jiraDynamicFields: JiraDynamicField[];
  jiraFieldValues: Record<string, unknown>;
  // Roadmap config
  createRoadmap: boolean;
  roadmapPlanning: string;
  roadmapStartDate: string;
  roadmapEndDate: string;
  // Shared
  title: string;
  description: string;
  // Result tracking
  jiraResult?: { success: boolean; key?: string; error?: string };
  roadmapResult?: { success: boolean; error?: string };
}

interface Props {
  documentId: string;
  onClose: () => void;
  onDone: () => void;
}

const API_BASE = '/suivitess-api';
const ROADMAP_API = '/roadmap-api';
const ISSUE_TYPES = ['Task', 'Story', 'Bug'];

type Step = 'select' | 'configure' | 'result';

function defaultEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SubjectAnalysisModal({ documentId, onClose, onDone }: Props) {
  const [step, setStep] = useState<Step>('select');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<Record<string, SubjectConfig>>({});

  // Service availability
  const [jiraAvailable, setJiraAvailable] = useState(false);
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [plannings, setPlannings] = useState<RoadmapPlanning[]>([]);
  // Cache: projectKey -> sprints
  const [sprintsCache, setSprintsCache] = useState<Record<string, JiraSprint[]>>({});
  // Cache: projectKey + issueType -> dynamic fields
  const [metaCache, setMetaCache] = useState<Record<string, JiraDynamicField[]>>({});

  const [creating, setCreating] = useState(false);
  const [creationProgress, setCreationProgress] = useState({ done: 0, total: 0 });

  // ============== Initial load ==============

  useEffect(() => {
    // Run AI analysis
    fetch(`${API_BASE}/documents/${documentId}/analyze-subjects-for-tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
      .then(async r => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || `Erreur ${r.status}`);
        }
        return r.json();
      })
      .then((data: { suggestions: Suggestion[] }) => {
        setSuggestions(data.suggestions || []);
        setSelectedIds(new Set((data.suggestions || []).map(s => s.subjectId)));
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Analyse echouee'))
      .finally(() => setLoading(false));

    // Load Jira availability + projects
    Promise.all([
      fetch('/api/connectors', { credentials: 'include' }).then(r => r.ok ? r.json() : []).catch(() => []),
      fetch('/api/auth/jira/status', { credentials: 'include' }).then(r => r.ok ? r.json() : { connected: false }).catch(() => ({ connected: false })),
    ]).then(([connectors, jiraStatus]: [Array<{ service: string; isActive: boolean }>, { connected: boolean }]) => {
      const isJiraAvail = connectors.some(c => c.service === 'jira' && c.isActive) || jiraStatus.connected;
      setJiraAvailable(isJiraAvail);
      if (isJiraAvail) {
        fetchJiraProjects().then(projects => setJiraProjects(sortJiraProjectsByUsage(projects))).catch(() => {});
      }
    });

    fetch(`${ROADMAP_API}/plannings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setPlannings)
      .catch(() => {});
  }, [documentId]);

  // ============== Helpers ==============

  const toggle = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const markNoActionNeeded = async (subjectId: string) => {
    try {
      await fetch(`${API_BASE}/subjects/${subjectId}/no-action`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ noActionNeeded: true }),
      });
    } catch { /* silent — removal from list is still useful */ }
    setSuggestions(prev => prev.filter(s => s.subjectId !== subjectId));
    setSelectedIds(prev => {
      const n = new Set(prev);
      n.delete(subjectId);
      return n;
    });
  };

  const goToConfigure = () => {
    // Build initial configs for selected subjects
    const newConfigs: Record<string, SubjectConfig> = {};
    for (const id of selectedIds) {
      const sug = suggestions.find(s => s.subjectId === id);
      if (!sug) continue;
      newConfigs[id] = configs[id] || {
        createJira: false,
        jiraProject: '',
        jiraSprint: '',
        jiraIssueType: 'Task',
        jiraDynamicFields: [],
        jiraFieldValues: {},
        createRoadmap: false,
        roadmapPlanning: '',
        roadmapStartDate: todayDate(),
        roadmapEndDate: defaultEndDate(),
        title: sug.suggestedTitle,
        description: sug.suggestedDescription,
      };
    }
    setConfigs(newConfigs);
    setStep('configure');
  };

  const updateConfig = (subjectId: string, patch: Partial<SubjectConfig>) => {
    setConfigs(prev => ({ ...prev, [subjectId]: { ...prev[subjectId], ...patch } }));
  };

  // Lazy-load sprints when project changes
  const loadSprints = useCallback(async (projectKey: string) => {
    if (sprintsCache[projectKey]) return;
    try {
      const sprints = await fetchJiraSprints(projectKey);
      setSprintsCache(prev => ({ ...prev, [projectKey]: sprints }));
    } catch {
      setSprintsCache(prev => ({ ...prev, [projectKey]: [] }));
    }
  }, [sprintsCache]);

  // Lazy-load dynamic fields when project + issueType change
  const loadMeta = useCallback(async (projectKey: string, issueType: string, subjectId: string) => {
    const key = `${projectKey}::${issueType}`;
    if (metaCache[key]) {
      updateConfig(subjectId, { jiraDynamicFields: metaCache[key] });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/jira/createmeta?projectKey=${encodeURIComponent(projectKey)}&issueType=${encodeURIComponent(issueType)}`, { credentials: 'include' });
      const data = res.ok ? await res.json() : { fields: [] };
      const fields = data.fields || [];
      setMetaCache(prev => ({ ...prev, [key]: fields }));
      updateConfig(subjectId, { jiraDynamicFields: fields });
    } catch {
      updateConfig(subjectId, { jiraDynamicFields: [] });
    }
  }, [metaCache]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildJiraFieldValue = (field: JiraDynamicField, rawValue: unknown): unknown => {
    if (rawValue === '' || rawValue === null || rawValue === undefined) return null;
    if (field.allowedValues && field.type !== 'array') return { id: String(rawValue) };
    if (field.allowedValues && field.type === 'array') {
      const ids = Array.isArray(rawValue) ? rawValue : [rawValue];
      return ids.filter(Boolean).map(id => ({ id: String(id) }));
    }
    if (field.type === 'number') return Number(rawValue);
    return rawValue;
  };

  // ============== Batch creation ==============

  const handleCreateAll = async () => {
    const tasks: Array<{ subjectId: string; type: 'jira' | 'roadmap' }> = [];
    for (const id of selectedIds) {
      const c = configs[id];
      if (!c) continue;
      if (c.createJira) tasks.push({ subjectId: id, type: 'jira' });
      if (c.createRoadmap) tasks.push({ subjectId: id, type: 'roadmap' });
    }
    if (tasks.length === 0) { setError('Aucun élément à créer — cochez Jira ou Roadmap pour au moins un sujet'); return; }

    setError('');
    setCreating(true);
    setCreationProgress({ done: 0, total: tasks.length });

    for (const t of tasks) {
      const c = configs[t.subjectId];
      try {
        if (t.type === 'jira') {
          const customFields: Record<string, unknown> = {};
          for (const f of c.jiraDynamicFields) {
            const v = buildJiraFieldValue(f, c.jiraFieldValues[f.id]);
            if (v !== null) customFields[f.id] = v;
          }
          const res = await fetch(`${API_BASE}/subjects/${t.subjectId}/create-jira-ticket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              projectKey: c.jiraProject,
              sprintId: c.jiraSprint || undefined,
              issueType: c.jiraIssueType,
              summary: c.title,
              description: c.description,
              customFields,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            updateConfig(t.subjectId, { jiraResult: { success: false, error: err.error || `HTTP ${res.status}` } });
          } else {
            const data = await res.json();
            updateConfig(t.subjectId, { jiraResult: { success: true, key: data.link?.externalId } });
            if (c.jiraProject) recordJiraProjectUsage(c.jiraProject);
          }
        } else {
          const res = await fetch(`${API_BASE}/subjects/${t.subjectId}/create-roadmap-task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              planningId: c.roadmapPlanning,
              title: c.title,
              startDate: c.roadmapStartDate,
              endDate: c.roadmapEndDate,
              description: c.description,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            updateConfig(t.subjectId, { roadmapResult: { success: false, error: err.error || `HTTP ${res.status}` } });
          } else {
            updateConfig(t.subjectId, { roadmapResult: { success: true } });
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Erreur';
        if (t.type === 'jira') updateConfig(t.subjectId, { jiraResult: { success: false, error: errorMsg } });
        else updateConfig(t.subjectId, { roadmapResult: { success: false, error: errorMsg } });
      }
      setCreationProgress(prev => ({ ...prev, done: prev.done + 1 }));
    }

    setCreating(false);
    setStep('result');
    onDone();
  };

  const totalToCreate = Object.values(configs).reduce((acc, c) => acc + (c?.createJira ? 1 : 0) + (c?.createRoadmap ? 1 : 0), 0);

  // ============== Render ==============

  return (
    <Modal title="Analyse IA — Création de tickets" onClose={onClose} size="xl">
      <div className={styles.content}>
        {/* STEP 1: Selection */}
        {step === 'select' && (
          <>
            {loading ? (
              <p className={styles.loading}>L'IA analyse les sujets...</p>
            ) : error ? (
              <p className={styles.error}>{error}</p>
            ) : suggestions.length === 0 ? (
              <p className={styles.empty}>Aucun sujet ne necessite la creation d'un ticket.</p>
            ) : (
              <>
                <p className={styles.intro}>
                  {suggestions.length} sujet{suggestions.length > 1 ? 's' : ''} pourrai{suggestions.length > 1 ? 'ent' : 't'} bénéficier d'un ticket. Sélectionnez ceux que vous voulez traiter.
                </p>
                <div className={styles.list}>
                  {suggestions.map(s => (
                    <div key={s.subjectId} className={styles.item}>
                      <label className={styles.itemLabel}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.subjectId)}
                          onChange={() => toggle(s.subjectId)}
                        />
                        <div className={styles.itemContent}>
                          <div className={styles.itemTitle}>{s.subjectTitle}</div>
                          <p className={styles.reason}>{s.reason}</p>
                          <p className={styles.suggested}>→ Suggéré : <strong>{s.suggestedTitle}</strong></p>
                        </div>
                      </label>
                      <button
                        type="button"
                        className={styles.noActionBtn}
                        onClick={() => markNoActionNeeded(s.subjectId)}
                        title="Marquer comme sans suite — ce sujet ne sera plus proposé dans les prochaines analyses IA"
                      >
                        Sans suite
                      </button>
                    </div>
                  ))}
                </div>
                <div className={styles.actions}>
                  <Button variant="secondary" onClick={onClose}>Annuler</Button>
                  <Button variant="primary" onClick={goToConfigure} disabled={selectedIds.size === 0}>
                    Continuer ({selectedIds.size} sujet{selectedIds.size > 1 ? 's' : ''}) →
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {/* STEP 2: Configure */}
        {step === 'configure' && (
          <>
            <p className={styles.intro}>
              Pour chaque sujet, choisissez de créer un ticket Jira et/ou une position Roadmap. Personnalisez les champs si nécessaire.
            </p>
            <div className={styles.subjectList}>
              {Array.from(selectedIds).map(id => {
                const sug = suggestions.find(s => s.subjectId === id);
                const c = configs[id];
                if (!sug || !c) return null;
                const projectSprints = c.jiraProject ? sprintsCache[c.jiraProject] || [] : [];

                return (
                  <div key={id} className={styles.subjectCard}>
                    <div className={styles.subjectHeader}>
                      <h4 className={styles.subjectName}>{sug.subjectTitle}</h4>
                    </div>

                    <div className={styles.fieldGrid}>
                      <label className={styles.fieldLabel}>Titre</label>
                      <input
                        type="text"
                        className={styles.fieldInput}
                        value={c.title}
                        onChange={e => updateConfig(id, { title: e.target.value })}
                      />
                      <label className={styles.fieldLabel}>Description</label>
                      <textarea
                        className={styles.fieldInput}
                        rows={2}
                        value={c.description}
                        onChange={e => updateConfig(id, { description: e.target.value })}
                      />
                    </div>

                    {/* Jira sub-card */}
                    {jiraAvailable && (
                      <div className={`${styles.serviceCard} ${c.createJira ? styles.serviceCardActive : ''}`}>
                        <label className={styles.serviceToggle}>
                          <input
                            type="checkbox"
                            checked={c.createJira}
                            onChange={e => updateConfig(id, { createJira: e.target.checked })}
                          />
                          <span className={styles.serviceLabel}>
                            <span className={styles.badgeJira}>Jira</span>
                            Créer un ticket
                          </span>
                        </label>
                        {c.createJira && (
                          <div className={styles.serviceForm}>
                            <div className={styles.fieldRow}>
                              <label className={styles.fieldLabel}>Projet</label>
                              <select
                                className={styles.fieldInput}
                                value={c.jiraProject}
                                onChange={e => {
                                  const proj = e.target.value;
                                  updateConfig(id, { jiraProject: proj, jiraSprint: '' });
                                  if (proj) {
                                    loadSprints(proj);
                                    loadMeta(proj, c.jiraIssueType, id);
                                  }
                                }}
                              >
                                <option value="">-- Choisir --</option>
                                {jiraProjects.map(p => (
                                  <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                                ))}
                              </select>
                            </div>
                            {projectSprints.length > 0 && (
                              <div className={styles.fieldRow}>
                                <label className={styles.fieldLabel}>Sprint</label>
                                <select
                                  className={styles.fieldInput}
                                  value={c.jiraSprint}
                                  onChange={e => updateConfig(id, { jiraSprint: e.target.value })}
                                >
                                  <option value="">Aucun</option>
                                  {projectSprints.filter(s => s.state !== 'closed').map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            <div className={styles.fieldRow}>
                              <label className={styles.fieldLabel}>Type</label>
                              <select
                                className={styles.fieldInput}
                                value={c.jiraIssueType}
                                onChange={e => {
                                  const it = e.target.value;
                                  updateConfig(id, { jiraIssueType: it });
                                  if (c.jiraProject) loadMeta(c.jiraProject, it, id);
                                }}
                              >
                                {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            {c.jiraDynamicFields.map(field => (
                              <div key={field.id} className={styles.fieldRow}>
                                <label className={styles.fieldLabel}>{field.name} *</label>
                                {field.allowedValues ? (
                                  <select
                                    className={styles.fieldInput}
                                    value={(c.jiraFieldValues[field.id] as string) || ''}
                                    onChange={e => updateConfig(id, { jiraFieldValues: { ...c.jiraFieldValues, [field.id]: e.target.value } })}
                                  >
                                    <option value="">-- Choisir --</option>
                                    {field.allowedValues.map(av => <option key={av.id} value={av.id}>{av.label}</option>)}
                                  </select>
                                ) : (
                                  <input
                                    type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                                    className={styles.fieldInput}
                                    value={(c.jiraFieldValues[field.id] as string) || ''}
                                    onChange={e => updateConfig(id, { jiraFieldValues: { ...c.jiraFieldValues, [field.id]: e.target.value } })}
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Roadmap sub-card */}
                    <div className={`${styles.serviceCard} ${c.createRoadmap ? styles.serviceCardActive : ''}`}>
                      <label className={styles.serviceToggle}>
                        <input
                          type="checkbox"
                          checked={c.createRoadmap}
                          onChange={e => updateConfig(id, { createRoadmap: e.target.checked })}
                        />
                        <span className={styles.serviceLabel}>
                          <span className={styles.badgeRoadmap}>Roadmap</span>
                          Créer une position
                        </span>
                      </label>
                      {c.createRoadmap && (
                        <div className={styles.serviceForm}>
                          <div className={styles.fieldRow}>
                            <label className={styles.fieldLabel}>Roadmap</label>
                            <select
                              className={styles.fieldInput}
                              value={c.roadmapPlanning}
                              onChange={e => updateConfig(id, { roadmapPlanning: e.target.value })}
                            >
                              <option value="">-- Choisir --</option>
                              {plannings.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </div>
                          <div className={styles.dateRow}>
                            <div>
                              <label className={styles.fieldLabel}>Debut</label>
                              <input
                                type="date"
                                className={styles.fieldInput}
                                value={c.roadmapStartDate}
                                onChange={e => updateConfig(id, { roadmapStartDate: e.target.value })}
                              />
                            </div>
                            <div>
                              <label className={styles.fieldLabel}>Fin</label>
                              <input
                                type="date"
                                className={styles.fieldInput}
                                value={c.roadmapEndDate}
                                onChange={e => updateConfig(id, { roadmapEndDate: e.target.value })}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {error && <p className={styles.error}>{error}</p>}
            {creating && (
              <p className={styles.loading}>
                Création en cours... {creationProgress.done}/{creationProgress.total}
              </p>
            )}

            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => setStep('select')} disabled={creating}>← Retour</Button>
              <Button variant="primary" onClick={handleCreateAll} disabled={creating || totalToCreate === 0}>
                {creating ? 'Création...' : `Tout créer (${totalToCreate} élément${totalToCreate > 1 ? 's' : ''})`}
              </Button>
            </div>
          </>
        )}

        {/* STEP 3: Result */}
        {step === 'result' && (
          <>
            <p className={styles.intro}>Resultat de la creation :</p>
            <div className={styles.resultList}>
              {Array.from(selectedIds).map(id => {
                const sug = suggestions.find(s => s.subjectId === id);
                const c = configs[id];
                if (!sug || !c) return null;
                if (!c.createJira && !c.createRoadmap) return null;
                return (
                  <div key={id} className={styles.resultCard}>
                    <div className={styles.resultTitle}>{sug.subjectTitle}</div>
                    {c.createJira && (
                      <div className={`${styles.resultRow} ${c.jiraResult?.success ? styles.resultOk : styles.resultErr}`}>
                        <span className={styles.badgeJira}>Jira</span>
                        {c.jiraResult?.success ? `✓ Cree (${c.jiraResult.key})` : `✗ ${c.jiraResult?.error || 'Echec'}`}
                      </div>
                    )}
                    {c.createRoadmap && (
                      <div className={`${styles.resultRow} ${c.roadmapResult?.success ? styles.resultOk : styles.resultErr}`}>
                        <span className={styles.badgeRoadmap}>Roadmap</span>
                        {c.roadmapResult?.success ? '✓ Cree' : `✗ ${c.roadmapResult?.error || 'Echec'}`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onClose}>Fermer</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default SubjectAnalysisModal;
