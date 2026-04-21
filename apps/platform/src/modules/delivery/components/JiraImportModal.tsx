import { useState, useEffect } from 'react';
import {
  fetchJiraProjects,
  fetchJiraSprints,
  fetchJiraIssues,
  fetchJiraIssueByUrl,
  createTask,
} from '../services/api';
import type { JiraProject, JiraSprint, JiraIssue, JiraIssueFromUrl } from '../services/api';
import { recordJiraProjectUsage, sortJiraProjectsByUsage } from '../services/jiraProjectUsage';
import { mapIssueType, formatJiraTitle } from '../utils/jiraUtils';
import styles from './JiraImportModal.module.css';

interface JiraImportModalProps {
  incrementId: string;
  onImported: () => void;
  onClose: () => void;
}

type Step = 'sprints' | 'issues';
/** Top-level mode : the user either scrolls sprints OR pastes a URL. */
type Mode = 'sprints' | 'url';

export function JiraImportModal({ incrementId, onImported, onClose }: JiraImportModalProps) {
  const [mode, setMode] = useState<Mode>('sprints');
  const [step, setStep] = useState<Step>('sprints');

  // URL mode state (independent from sprints flow).
  const [urlInput, setUrlInput] = useState('');
  const [urlPreview, setUrlPreview] = useState<JiraIssueFromUrl | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlCreating, setUrlCreating] = useState(false);

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
      .then(projects => setProjects(sortJiraProjectsByUsage(projects)))
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
          status: issue.status,
          storyPoints: issue.storyPoints,
          assignee: issue.assignee,
          sprintName: issue.sprintName,
          incrementId,
          source: 'jira',
        }).catch(() => { failed++; })
      )
    );
    setImporting(false);
    if (failed > 0 && failed < toImport.length) {
      setError(`${failed} ticket(s) n'ont pas pu etre importes.`);
    } else if (failed === toImport.length) {
      setError('Echec de l\'import. Verifiez votre connexion Jira.');
    } else {
      if (selectedProjectKey) recordJiraProjectUsage(selectedProjectKey);
      onImported();
      onClose();
    }
  };

  const handleUrlPreview = async () => {
    const raw = urlInput.trim();
    if (!raw) return;
    setError(null);
    setUrlPreview(null);
    setUrlLoading(true);
    try {
      const res = await fetchJiraIssueByUrl(raw);
      setUrlPreview(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUrlLoading(false);
    }
  };

  const handleUrlImport = async () => {
    if (!urlPreview) return;
    setError(null);
    setUrlCreating(true);
    try {
      // Use the legacy `createTask` path (not `createTaskFromJiraUrl`
      // which requires a boardId this modal doesn't carry). The preview
      // response already has all the fields we need — denormalized, no
      // extra Jira call needed here.
      await createTask({
        title: formatJiraTitle(urlPreview.key, urlPreview.summary),
        type: mapIssueType(urlPreview.issueType),
        status: urlPreview.status,
        storyPoints: urlPreview.storyPoints ?? undefined,
        estimatedDays: urlPreview.estimatedDays ?? undefined,
        assignee: urlPreview.assignee ?? undefined,
        sprintName: urlPreview.sprintName ?? undefined,
        incrementId,
        source: 'jira',
      });
      onImported();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setUrlCreating(false);
    }
  };

  const title = mode === 'url'
    ? 'Importer depuis Jira — par URL'
    : step === 'sprints'
      ? 'Importer depuis Jira — Etape 1 : Sprints'
      : `Importer depuis Jira — Etape 2 : Tickets (${issues.length})`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>{title}</h3>
          <button className={styles.closeBtn} onClick={onClose} type="button">&times;</button>
        </div>

        {/* Mode switcher — segmented control (Sprints | URL) */}
        <div className={styles.modeSwitcher}>
          <button
            type="button"
            className={`${styles.modeBtn} ${mode === 'sprints' ? styles.modeBtnActive : ''}`}
            onClick={() => { setMode('sprints'); setError(null); }}
          >
            Par sprint
          </button>
          <button
            type="button"
            className={`${styles.modeBtn} ${mode === 'url' ? styles.modeBtnActive : ''}`}
            onClick={() => { setMode('url'); setError(null); }}
          >
            🔗 Par URL
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        {mode === 'url' && (
          <div className={styles.body}>
            <div className={styles.field}>
              <label className={styles.label}>URL ou clé Jira</label>
              <p className={styles.hint}>
                Colle l'URL d'un ticket Jira, ou juste sa clé (ex : <code>TVSMART-2181</code>).
                On utilise ta connexion Jira (OAuth ou token) pour récupérer les détails.
              </p>
              <div className={styles.urlRow}>
                <input
                  type="text"
                  className={styles.urlInput}
                  placeholder="https://…/browse/TVSMART-2181  ou  TVSMART-2181"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  disabled={urlLoading || urlCreating}
                  onKeyDown={e => { if (e.key === 'Enter' && urlInput.trim() && !urlPreview) handleUrlPreview(); }}
                  autoFocus
                />
                {!urlPreview && (
                  <button
                    type="button"
                    className={styles.primaryBtn}
                    disabled={urlLoading || !urlInput.trim()}
                    onClick={handleUrlPreview}
                  >
                    {urlLoading ? 'Chargement…' : 'Prévisualiser'}
                  </button>
                )}
              </div>
            </div>

            {urlPreview && (
              <div className={styles.urlPreview}>
                <div className={styles.urlPreviewHead}>
                  <span className={styles.urlPreviewKey}>{urlPreview.key}</span>
                  <span className={styles.urlPreviewType}>{urlPreview.issueType}</span>
                  <span className={styles.urlPreviewStatus}>{urlPreview.status}</span>
                  <span className={styles.urlPreviewAuth} title={urlPreview.authMode === 'oauth' ? 'Récupéré via OAuth 2.0' : 'Récupéré via token Basic Auth'}>
                    {urlPreview.authMode === 'oauth' ? '🔐 OAuth' : '🔑 Token'}
                  </span>
                </div>
                <h4 className={styles.urlPreviewSummary}>{urlPreview.summary}</h4>
                <div className={styles.urlPreviewMeta}>
                  {urlPreview.assignee && <span>👤 {urlPreview.assignee}</span>}
                  {urlPreview.storyPoints != null && <span>⚡ {urlPreview.storyPoints} SP</span>}
                  {urlPreview.estimatedDays != null && <span>📆 {urlPreview.estimatedDays} j</span>}
                  {urlPreview.fixVersion && <span>🎯 {urlPreview.fixVersion}</span>}
                  {urlPreview.sprintName && <span>🏃 {urlPreview.sprintName}</span>}
                  {urlPreview.priority && <span>⚑ {urlPreview.priority}</span>}
                </div>
              </div>
            )}

            <div className={styles.footer}>
              <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={urlCreating}>
                Annuler
              </button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={!urlPreview || urlCreating}
                onClick={handleUrlImport}
              >
                {urlCreating ? 'Import…' : 'Importer ce ticket'}
              </button>
            </div>
          </div>
        )}

        {mode === 'sprints' && step === 'sprints' && (
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
                  <option value="">-- Sélectionner un projet --</option>
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

        {mode === 'sprints' && step === 'issues' && (
          <div className={styles.body}>
            <div className={styles.issueActions}>
              <button className={styles.linkBtn} onClick={selectAllIssues}>Tout sélectionner</button>
              <button className={styles.linkBtn} onClick={deselectAllIssues}>Tout désélectionner</button>
              <span className={styles.counter}>{selectedIssueIds.size} sélectionné(s)</span>
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

        {/* Sprints-mode footer — only rendered in sprints mode. In URL
            mode the body already has its own footer ("Annuler" / "Importer
            ce ticket"), so rendering this one too stacked two sets of
            buttons on top of each other. */}
        {mode === 'sprints' && (
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
        )}
      </div>
    </div>
  );
}
