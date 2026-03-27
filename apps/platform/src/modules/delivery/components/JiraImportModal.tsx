import { useState, useEffect } from 'react';
import {
  fetchJiraProjects,
  fetchJiraSprints,
  fetchJiraIssues,
  createTask,
} from '../services/api';
import type { JiraProject, JiraSprint, JiraIssue } from '../services/api';
import { mapIssueType, formatJiraTitle } from '../utils/jiraUtils';
import styles from './JiraImportModal.module.css';

interface JiraImportModalProps {
  incrementId: string;
  onImported: () => void;
  onClose: () => void;
}

type Step = 'sprints' | 'issues';

export function JiraImportModal({ incrementId, onImported, onClose }: JiraImportModalProps) {
  const [step, setStep] = useState<Step>('sprints');

  // Step 1 state
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [selectedProjectKey, setSelectedProjectKey] = useState('');
  const [sprints, setSprints] = useState<JiraSprint[]>([]);
  const [selectedSprintIds, setSelectedSprintIds] = useState<Set<number>>(new Set());
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingSprints, setLoadingSprints] = useState(false);

  // Step 2 state
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [importing, setImporting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Load projects on mount
  useEffect(() => {
    setLoadingProjects(true);
    setError(null);
    fetchJiraProjects()
      .then(setProjects)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingProjects(false));
  }, []);

  // Load sprints when project changes
  useEffect(() => {
    if (!selectedProjectKey) {
      setSprints([]);
      setSelectedSprintIds(new Set());
      return;
    }
    setLoadingSprints(true);
    setError(null);
    setSelectedSprintIds(new Set());
    fetchJiraSprints(selectedProjectKey)
      .then(setSprints)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoadingSprints(false));
  }, [selectedProjectKey]);

  const toggleSprint = (id: number) => {
    const next = new Set(selectedSprintIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSprintIds(next);
  };

  const toggleIssue = (id: string) => {
    const next = new Set(selectedIssueIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIssueIds(next);
  };

  const selectAllIssues = () => setSelectedIssueIds(new Set(issues.map(i => i.id)));
  const deselectAllIssues = () => setSelectedIssueIds(new Set());

  const goToStep2 = async () => {
    setLoadingIssues(true);
    setError(null);
    setSelectedIssueIds(new Set());
    try {
      const data = await fetchJiraIssues(Array.from(selectedSprintIds));
      setIssues(data);
      setStep('issues');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingIssues(false);
    }
  };

  const handleImport = async () => {
    const toImport = issues.filter(i => selectedIssueIds.has(i.id));
    setImporting(true);
    setError(null);
    let failed = 0;
    await Promise.all(
      toImport.map(issue =>
        createTask({
          title: formatJiraTitle(issue.key, issue.summary),
          type: mapIssueType(issue.issueType),
          status: 'todo',
          storyPoints: issue.storyPoints,
          assignee: issue.assignee,
          sprintName: issue.sprintName,
          incrementId,
        }).catch(() => { failed++; })
      )
    );
    setImporting(false);
    if (failed > 0 && failed < toImport.length) {
      setError(`${failed} ticket(s) n'ont pas pu etre importes.`);
    } else if (failed === toImport.length) {
      setError('Echec de l\'import. Verifiez votre connexion Jira.');
    } else {
      onImported();
      onClose();
    }
  };

  const title = step === 'sprints'
    ? 'Importer depuis Jira — Etape 1 : Sprints'
    : `Importer depuis Jira — Etape 2 : Tickets (${issues.length})`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          <button className={styles.closeBtn} onClick={onClose} type="button">&times;</button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {step === 'sprints' && (
          <div className={styles.body}>
            {/* Project selector */}
            <div className={styles.field}>
              <label className={styles.label}>Projet Jira</label>
              {loadingProjects ? (
                <div className={styles.loading}><span className={styles.spinner} /> Chargement des projets...</div>
              ) : (
                <select
                  className={styles.select}
                  value={selectedProjectKey}
                  onChange={(e) => setSelectedProjectKey(e.target.value)}
                >
                  <option value="">-- Selectionner un projet --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.key}>{p.name} ({p.key})</option>
                  ))}
                </select>
              )}
            </div>

            {/* Sprint list */}
            {selectedProjectKey && (
              <div className={styles.field}>
                <label className={styles.label}>Sprints</label>
                {loadingSprints ? (
                  <div className={styles.loading}><span className={styles.spinner} /> Chargement des sprints...</div>
                ) : sprints.length === 0 ? (
                  <div className={styles.empty}>Aucun sprint trouve pour ce projet.</div>
                ) : (
                  <div className={styles.list}>
                    {sprints.map(sprint => (
                      <label key={sprint.id} className={styles.item}>
                        <input
                          type="checkbox"
                          checked={selectedSprintIds.has(sprint.id)}
                          onChange={() => toggleSprint(sprint.id)}
                        />
                        <span className={`${styles.sprintState} ${styles[sprint.state]}`}>
                          {sprint.state === 'active' ? 'ACTIF' : 'FERME'}
                        </span>
                        <span className={styles.itemName}>{sprint.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 'issues' && (
          <div className={styles.body}>
            <div className={styles.issueActions}>
              <button className={styles.linkBtn} onClick={selectAllIssues}>Tout selectionner</button>
              <button className={styles.linkBtn} onClick={deselectAllIssues}>Tout deselectionner</button>
              <span className={styles.counter}>{selectedIssueIds.size} selectionne(s)</span>
            </div>
            {loadingIssues ? (
              <div className={styles.loading}><span className={styles.spinner} /> Chargement des tickets...</div>
            ) : issues.length === 0 ? (
              <div className={styles.empty}>Aucun ticket trouve dans ces sprints.</div>
            ) : (
              <div className={styles.list}>
                {issues.map(issue => (
                  <label key={issue.id} className={styles.item}>
                    <input
                      type="checkbox"
                      checked={selectedIssueIds.has(issue.id)}
                      onChange={() => toggleIssue(issue.id)}
                    />
                    <span className={styles.issueKey}>{issue.key}</span>
                    <span className={styles.issueSummary}>{issue.summary}</span>
                    <span className={styles.issueMeta}>
                      {issue.status}
                      {issue.storyPoints != null && ` · ${issue.storyPoints}pt`}
                      {issue.assignee && ` · ${issue.assignee}`}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.footer}>
          {step === 'sprints' ? (
            <>
              <button className={styles.cancelBtn} onClick={onClose}>Annuler</button>
              <button
                className={styles.primaryBtn}
                onClick={goToStep2}
                disabled={selectedSprintIds.size === 0 || loadingIssues}
              >
                {loadingIssues ? 'Chargement...' : `Suivant (${selectedSprintIds.size} sprint(s))`}
              </button>
            </>
          ) : (
            <>
              <button className={styles.cancelBtn} onClick={() => setStep('sprints')}>
                Retour
              </button>
              <button
                className={styles.primaryBtn}
                onClick={handleImport}
                disabled={selectedIssueIds.size === 0 || importing}
              >
                {importing ? 'Import en cours...' : `Importer (${selectedIssueIds.size})`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
