import { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Tabs, FormField } from '@boilerplate/shared/components';
import { fetchJiraProjects, fetchJiraSprints } from '../../../delivery/services/api';
import type { JiraProject, JiraSprint } from '../../../delivery/services/api';
import { recordJiraProjectUsage, sortJiraProjectsByUsage } from '../../../delivery/services/jiraProjectUsage';
import styles from './TicketCreateModal.module.css';

export type TargetService = 'jira' | 'notion' | 'roadmap';

interface Props {
  subjectId: string;
  subjectTitle: string;
  subjectSituation: string | null;
  initialService?: TargetService;
  onClose: () => void;
  onCreated: () => void;
}

interface RoadmapPlanning {
  id: string;
  name: string;
}

interface NotionDatabase {
  id: string;
  title: string;
}

const SUIVITESS_API = '/suivitess-api';
const ROADMAP_API = '/roadmap-api';

const ISSUE_TYPES = ['Task', 'Story', 'Bug'];

export function TicketCreateModal({
  subjectId,
  subjectTitle,
  subjectSituation,
  initialService,
  onClose,
  onCreated,
}: Props) {
  // Tab state
  const [tab, setTab] = useState<TargetService>(initialService || 'jira');
  const [jiraAvailable, setJiraAvailable] = useState(false);
  const [notionAvailable, setNotionAvailable] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(true);

  // Shared
  const [title, setTitle] = useState(subjectTitle);
  const [description, setDescription] = useState(subjectSituation || '');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  // Jira state
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [jiraProject, setJiraProject] = useState('');
  const [jiraSprints, setJiraSprints] = useState<JiraSprint[]>([]);
  const [jiraSprint, setJiraSprint] = useState('');
  const [jiraIssueType, setJiraIssueType] = useState('Task');
  const [loadingJira, setLoadingJira] = useState(false);
  // Dynamic required fields (from Jira createmeta)
  const [jiraDynamicFields, setJiraDynamicFields] = useState<Array<{
    id: string; name: string; required: boolean; type: string;
    items: string | null; allowedValues: Array<{ id: string; label: string }> | null;
  }>>([]);
  const [jiraFieldValues, setJiraFieldValues] = useState<Record<string, unknown>>({});
  const [loadingMeta, setLoadingMeta] = useState(false);

  // Notion state
  const [notionDbs, setNotionDbs] = useState<NotionDatabase[]>([]);
  const [notionDb, setNotionDb] = useState('');
  const [loadingNotion, setLoadingNotion] = useState(false);

  // Roadmap state
  const [plannings, setPlannings] = useState<RoadmapPlanning[]>([]);
  const [planning, setPlanning] = useState('');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });

  // Detect available services — wait for ALL checks before showing UI
  useEffect(() => {
    setCheckingAvailability(true);
    Promise.all([
      fetch('/api/connectors', { credentials: 'include' })
        .then(r => r.ok ? r.json() : [])
        .catch(() => []),
      fetch('/api/auth/jira/status', { credentials: 'include' })
        .then(r => r.ok ? r.json() : { connected: false })
        .catch(() => ({ connected: false })),
    ]).then(([connectors, jiraStatus]: [Array<{ service: string; isActive: boolean }>, { connected: boolean }]) => {
      const jiraConnector = connectors.some(c => c.service === 'jira' && c.isActive);
      setJiraAvailable(jiraConnector || jiraStatus.connected);
      setNotionAvailable(connectors.some(c => c.service === 'notion' && c.isActive));
    }).finally(() => setCheckingAvailability(false));

    // Load plannings (always available)
    fetch(`${ROADMAP_API}/plannings`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setPlannings)
      .catch(() => {});
  }, []);

  // Auto-switch tab if the requested service is not connected
  useEffect(() => {
    if (checkingAvailability) return;
    if (tab === 'jira' && !jiraAvailable) {
      if (notionAvailable) setTab('notion');
      else setTab('roadmap');
    } else if (tab === 'notion' && !notionAvailable) {
      if (jiraAvailable) setTab('jira');
      else setTab('roadmap');
    }
  }, [checkingAvailability, jiraAvailable, notionAvailable, tab]);

  // Load Jira projects when Jira tab activated
  useEffect(() => {
    if (tab !== 'jira' || !jiraAvailable || jiraProjects.length > 0) return;
    setLoadingJira(true);
    fetchJiraProjects()
      .then(projects => setJiraProjects(sortJiraProjectsByUsage(projects)))
      .catch(() => setError('Impossible de charger les projets Jira'))
      .finally(() => setLoadingJira(false));
  }, [tab, jiraAvailable, jiraProjects.length]);

  // Load sprints when project changes
  useEffect(() => {
    if (!jiraProject) { setJiraSprints([]); return; }
    fetchJiraSprints(jiraProject)
      .then(setJiraSprints)
      .catch(() => setJiraSprints([]));
  }, [jiraProject]);

  // Load required dynamic fields when project + issue type change
  useEffect(() => {
    if (!jiraProject || !jiraIssueType || tab !== 'jira') {
      setJiraDynamicFields([]);
      setJiraFieldValues({});
      return;
    }
    setLoadingMeta(true);
    fetch(`${SUIVITESS_API}/jira/createmeta?projectKey=${encodeURIComponent(jiraProject)}&issueType=${encodeURIComponent(jiraIssueType)}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : { fields: [] })
      .then((data: { fields: typeof jiraDynamicFields }) => {
        setJiraDynamicFields(data.fields || []);
        setJiraFieldValues({});
      })
      .catch(() => { setJiraDynamicFields([]); })
      .finally(() => setLoadingMeta(false));
  }, [jiraProject, jiraIssueType, tab]);

  // Convert raw input value to Jira field format based on schema
  const buildJiraFieldValue = (field: typeof jiraDynamicFields[0], rawValue: unknown): unknown => {
    if (rawValue === '' || rawValue === null || rawValue === undefined) return null;
    // Single option (option, priority, etc) — { id }
    if (field.allowedValues && field.type !== 'array') {
      return { id: String(rawValue) };
    }
    // Array of options — [{ id }]
    if (field.allowedValues && field.type === 'array') {
      const ids = Array.isArray(rawValue) ? rawValue : [rawValue];
      return ids.filter(Boolean).map(id => ({ id: String(id) }));
    }
    // Number
    if (field.type === 'number') return Number(rawValue);
    // String, date, datetime
    return rawValue;
  };

  // Load Notion databases
  useEffect(() => {
    if (tab !== 'notion' || !notionAvailable || notionDbs.length > 0) return;
    setLoadingNotion(true);
    fetch(`${SUIVITESS_API}/notion/databases`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(setNotionDbs)
      .catch(() => setError('Impossible de charger les databases Notion'))
      .finally(() => setLoadingNotion(false));
  }, [tab, notionAvailable, notionDbs.length]);

  const canCreate = useCallback((): boolean => {
    if (!title.trim()) return false;
    if (tab === 'jira') {
      if (!jiraProject || !jiraIssueType) return false;
      // Verify all required dynamic fields are filled
      for (const f of jiraDynamicFields) {
        const v = jiraFieldValues[f.id];
        if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) return false;
      }
      return true;
    }
    if (tab === 'notion') return !!notionDb;
    if (tab === 'roadmap') return !!planning && !!startDate && !!endDate;
    return false;
  }, [tab, title, jiraProject, jiraIssueType, jiraDynamicFields, jiraFieldValues, notionDb, planning, startDate, endDate]);

  const handleCreate = async () => {
    setCreating(true); setError('');
    try {
      let url = '';
      let body: Record<string, unknown> = {};

      if (tab === 'jira') {
        url = `${SUIVITESS_API}/subjects/${subjectId}/create-jira-ticket`;
        // Build customFields dict in Jira format
        const customFields: Record<string, unknown> = {};
        for (const f of jiraDynamicFields) {
          const formatted = buildJiraFieldValue(f, jiraFieldValues[f.id]);
          if (formatted !== null) customFields[f.id] = formatted;
        }
        body = {
          projectKey: jiraProject,
          sprintId: jiraSprint || undefined,
          issueType: jiraIssueType,
          summary: title,
          description,
          customFields,
        };
      } else if (tab === 'notion') {
        url = `${SUIVITESS_API}/subjects/${subjectId}/create-notion-page`;
        body = { databaseId: notionDb, title, content: description };
      } else if (tab === 'roadmap') {
        url = `${SUIVITESS_API}/subjects/${subjectId}/create-roadmap-task`;
        body = { planningId: planning, title, startDate, endDate, description };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Erreur ${res.status}`);
      }
      if (tab === 'jira' && jiraProject) recordJiraProjectUsage(jiraProject);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setCreating(false);
    }
  };

  const tabs = [
    ...(jiraAvailable ? [{ value: 'jira' as const, label: 'Jira' }] : []),
    ...(notionAvailable ? [{ value: 'notion' as const, label: 'Notion' }] : []),
    { value: 'roadmap' as const, label: 'Roadmap' },
  ];

  return (
    <Modal title="Creer un element lie" onClose={onClose} size="md">
      <div className={styles.content}>
        <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v as TargetService)} />

        {/* Jira tab */}
        {tab === 'jira' && (
          <div className={styles.form}>
            {!jiraAvailable ? (
              <p className={styles.warning}>Connectez Jira dans Reglages pour creer un ticket.</p>
            ) : loadingJira ? (
              <p className={styles.loading}>Chargement des projets...</p>
            ) : (
              <>
                <FormField label="Projet" required>
                  <select value={jiraProject} onChange={e => setJiraProject(e.target.value)}>
                    <option value="">-- Choisir --</option>
                    {jiraProjects.map(p => (
                      <option key={p.key} value={p.key}>{p.name} ({p.key})</option>
                    ))}
                  </select>
                </FormField>
                {jiraSprints.length > 0 && (
                  <FormField label="Sprint (optionnel)">
                    <select value={jiraSprint} onChange={e => setJiraSprint(String(e.target.value))}>
                      <option value="">Aucun</option>
                      {jiraSprints.filter(s => s.state !== 'closed').map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </FormField>
                )}
                <FormField label="Type" required>
                  <select value={jiraIssueType} onChange={e => setJiraIssueType(e.target.value)}>
                    {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FormField>

                {/* Dynamic required fields */}
                {loadingMeta && <p className={styles.loading}>Chargement des champs requis...</p>}
                {jiraDynamicFields.map(field => (
                  <FormField key={field.id} label={field.name} required>
                    {field.allowedValues ? (
                      field.type === 'array' ? (
                        <select
                          multiple
                          value={(jiraFieldValues[field.id] as string[]) || []}
                          onChange={e => {
                            const values = Array.from(e.target.selectedOptions, o => o.value);
                            setJiraFieldValues(prev => ({ ...prev, [field.id]: values }));
                          }}
                          style={{ minHeight: 80 }}
                        >
                          {field.allowedValues.map(av => (
                            <option key={av.id} value={av.id}>{av.label}</option>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={(jiraFieldValues[field.id] as string) || ''}
                          onChange={e => setJiraFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                        >
                          <option value="">-- Choisir --</option>
                          {field.allowedValues.map(av => (
                            <option key={av.id} value={av.id}>{av.label}</option>
                          ))}
                        </select>
                      )
                    ) : field.type === 'number' ? (
                      <input
                        type="number"
                        value={(jiraFieldValues[field.id] as string) || ''}
                        onChange={e => setJiraFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                      />
                    ) : field.type === 'date' ? (
                      <input
                        type="date"
                        value={(jiraFieldValues[field.id] as string) || ''}
                        onChange={e => setJiraFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                      />
                    ) : field.type === 'datetime' ? (
                      <input
                        type="datetime-local"
                        value={(jiraFieldValues[field.id] as string) || ''}
                        onChange={e => setJiraFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                      />
                    ) : (
                      <input
                        type="text"
                        value={(jiraFieldValues[field.id] as string) || ''}
                        onChange={e => setJiraFieldValues(prev => ({ ...prev, [field.id]: e.target.value }))}
                        placeholder={`${field.name} (${field.type})`}
                      />
                    )}
                  </FormField>
                ))}
              </>
            )}
          </div>
        )}

        {/* Notion tab */}
        {tab === 'notion' && (
          <div className={styles.form}>
            {!notionAvailable ? (
              <p className={styles.warning}>Connectez Notion dans Reglages pour creer une page.</p>
            ) : loadingNotion ? (
              <p className={styles.loading}>Chargement des databases...</p>
            ) : (
              <FormField label="Database" required>
                <select value={notionDb} onChange={e => setNotionDb(e.target.value)}>
                  <option value="">-- Choisir --</option>
                  {notionDbs.map(d => (
                    <option key={d.id} value={d.id}>{d.title}</option>
                  ))}
                </select>
              </FormField>
            )}
          </div>
        )}

        {/* Roadmap tab */}
        {tab === 'roadmap' && (
          <div className={styles.form}>
            <FormField label="Roadmap" required>
              <select value={planning} onChange={e => setPlanning(e.target.value)}>
                <option value="">-- Choisir --</option>
                {plannings.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </FormField>
            <div className={styles.dateRow}>
              <FormField label="Debut" required>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              </FormField>
              <FormField label="Fin" required>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </FormField>
            </div>
          </div>
        )}

        {/* Shared fields */}
        <FormField label="Titre" required>
          <input type="text" value={title} onChange={e => setTitle(e.target.value)} />
        </FormField>
        <FormField label="Description">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            placeholder="Description detaillee..."
          />
        </FormField>

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={creating}>Annuler</Button>
          <Button variant="primary" onClick={handleCreate} disabled={!canCreate() || creating}>
            {creating ? 'Creation...' : 'Creer'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default TicketCreateModal;
