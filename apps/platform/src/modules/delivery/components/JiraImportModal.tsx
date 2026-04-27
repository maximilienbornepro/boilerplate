import { useState, useEffect, useMemo } from 'react';
import { Modal, ModalBody, Button } from '@boilerplate/shared/components';
import {
  fetchJiraProjects,
  fetchJiraSprints,
  fetchJiraIssues,
  fetchJiraIssueByUrl,
  fetchTasksForBoard,
  createTask,
  nestTaskApi,
} from '../services/api';
import type { JiraProject, JiraSprint, JiraIssue, JiraIssueFromUrl, Task } from '../services/api';
import { recordJiraProjectUsage, sortJiraProjectsByUsage } from '../services/jiraProjectUsage';
import { mapIssueType, formatJiraTitle, extractJiraKey } from '../utils/jiraUtils';
import styles from './JiraImportModal.module.css';

interface JiraImportModalProps {
  incrementId: string;
  /** Board id of the destination — used to detect tickets already
   *  imported (so duplicates don't get re-created) and to find or
   *  create the "Anomalie" container that bug tickets are nested
   *  under on bulk import. */
  boardId: string;
  onImported: () => void;
  onClose: () => void;
}

/** Title of the auto-created container that bulk-imported bug tickets
 *  are nested under. The user asked for this systematic placement so
 *  every imported anomaly lands in one predictable spot regardless of
 *  the source sprint. */
const ANOMALIE_CONTAINER_TITLE = 'Anomalie';

type Step = 'sprints' | 'issues';
/** Top-level mode : the user either scrolls sprints OR pastes a URL. */
type Mode = 'sprints' | 'url';

export function JiraImportModal({ incrementId, boardId, onImported, onClose }: JiraImportModalProps) {
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
  /** Hide tickets whose Jira `statusCategory` is `'done'` (Fermé /
   *  Closed / Resolved / Done — independent of UI language). On by
   *  default since closed tickets in the active sprint are usually
   *  noise during a board catch-up. */
  const [hideDone, setHideDone] = useState(true);

  // Existing board tasks — used to flag Jira issues already in the
  // board so the user doesn't re-import duplicates. Loaded once on
  // mount and refreshed whenever a successful import happens.
  const [existingTasks, setExistingTasks] = useState<Task[]>([]);
  const existingJiraKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of existingTasks) {
      const k = extractJiraKey(t.title);
      if (k) keys.add(k);
    }
    return keys;
  }, [existingTasks]);

  const [error, setError] = useState<string | null>(null);

  // Pre-load the board's tasks so step 2 can mark already-imported
  // tickets without an extra round-trip when the user clicks "Suivant".
  useEffect(() => {
    if (!boardId) return;
    fetchTasksForBoard(boardId)
      .then(setExistingTasks)
      .catch(() => { /* non-fatal — duplicate detection just stays blank */ });
  }, [boardId]);

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

  const selectAllIssues = () => setSelectedIssueIds(new Set(visibleIssues.map(i => i.id)));
  const deselectAllIssues = () => setSelectedIssueIds(new Set());
  /** Tick only the issues whose Jira key isn't already in the board.
   *  The most common bulk-import use case — the user just wants to
   *  catch up on what's missing without manually unticking duplicates. */
  const selectMissingIssues = () => setSelectedIssueIds(
    new Set(visibleIssues.filter(i => !existingJiraKeys.has(i.key)).map(i => i.id)),
  );

  /** Visible issues = filtered by the "hide done" toggle. The full
   *  `issues` list stays in state so toggling re-shows hidden rows
   *  without re-fetching from Jira. */
  const visibleIssues = useMemo(
    () => hideDone ? issues.filter(i => i.statusCategory !== 'done') : issues,
    [issues, hideDone],
  );

  const hiddenDoneCount = useMemo(
    () => issues.filter(i => i.statusCategory === 'done').length,
    [issues],
  );

  const missingIssuesCount = useMemo(
    () => visibleIssues.filter(i => !existingJiraKeys.has(i.key)).length,
    [visibleIssues, existingJiraKeys],
  );

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

  /** Find the existing top-level "Anomalie" container in the board,
   *  or create one if none exists. Top-level = `parentTaskId == null`
   *  to avoid nesting under another container by accident. */
  const ensureAnomalieContainer = async (): Promise<string | null> => {
    const existing = existingTasks.find(t =>
      t.source === 'manual'
      && (t.parentTaskId == null)
      && t.title.trim().toLowerCase() === ANOMALIE_CONTAINER_TITLE.toLowerCase(),
    );
    if (existing) return existing.id;
    try {
      const created = await createTask({
        title: ANOMALIE_CONTAINER_TITLE,
        type: 'bug',
        source: 'manual',
        incrementId,
      });
      // Cache it locally so a 2nd import in the same modal session
      // doesn't create a duplicate container.
      setExistingTasks(prev => [...prev, created as Task]);
      return created.id;
    } catch {
      return null;
    }
  };

  const handleImport = async () => {
    const toImport = issues.filter(i => selectedIssueIds.has(i.id));
    setImporting(true);
    setError(null);
    let failed = 0;

    // Pre-create / fetch the Anomalie container only if at least one
    // bug is in the batch — avoid spawning the container for purely
    // feature/tech imports.
    const hasBugs = toImport.some(i => mapIssueType(i.issueType) === 'bug');
    let anomalieContainerId: string | null = null;
    if (hasBugs) {
      anomalieContainerId = await ensureAnomalieContainer();
    }

    // Run imports sequentially when nesting is involved so the order
    // of nestTaskApi calls is deterministic. Non-bug imports stay
    // parallel — they don't touch shared state.
    const bugs = toImport.filter(i => mapIssueType(i.issueType) === 'bug');
    const nonBugs = toImport.filter(i => mapIssueType(i.issueType) !== 'bug');

    await Promise.all(
      nonBugs.map(issue =>
        createTask({
          title: formatJiraTitle(issue.key, issue.summary),
          type: mapIssueType(issue.issueType),
          status: issue.status,
          storyPoints: issue.storyPoints,
          assignee: issue.assignee,
          sprintName: issue.sprintName,
          incrementId,
          source: 'jira',
        }).catch(() => { failed++; }),
      ),
    );

    for (const issue of bugs) {
      try {
        const created = await createTask({
          title: formatJiraTitle(issue.key, issue.summary),
          type: 'bug',
          status: issue.status,
          storyPoints: issue.storyPoints,
          assignee: issue.assignee,
          sprintName: issue.sprintName,
          incrementId,
          source: 'jira',
        });
        if (anomalieContainerId) {
          await nestTaskApi(created.id, anomalieContainerId).catch(() => {
            /* nesting is best-effort — leave the bug at root if it
               fails rather than killing the whole import. */
          });
        }
      } catch {
        failed++;
      }
    }

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
    <Modal title={title} onClose={onClose} size="md">
      <ModalBody>
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
              <Button variant="secondary" type="button" onClick={onClose} disabled={urlCreating}>
                Annuler
              </Button>
              <Button variant="primary" type="button" disabled={!urlPreview || urlCreating} onClick={handleUrlImport}>
                {urlCreating ? 'Import…' : 'Importer ce ticket'}
              </Button>
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
              {missingIssuesCount > 0 && missingIssuesCount < visibleIssues.length && (
                <button className={styles.linkBtn} onClick={selectMissingIssues}>
                  Sélectionner les {missingIssuesCount} non importés
                </button>
              )}
              {/* "Hide done" toggle — surfaces only when at least one
                  closed ticket is in the batch so users with a sprint
                  full of in-progress tickets don't see a useless
                  switch. */}
              {hiddenDoneCount > 0 && (
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                  title="Les tickets terminés dans Jira (Fermé / Done / Resolved) sont masqués par défaut."
                >
                  <input
                    type="checkbox"
                    checked={hideDone}
                    onChange={(e) => setHideDone(e.target.checked)}
                  />
                  Masquer les terminés ({hiddenDoneCount})
                </label>
              )}
              <span className={styles.counter}>{selectedIssueIds.size} sélectionné(s)</span>
            </div>
            {loadingIssues ? (
              <div className={styles.loading}><span className={styles.spinner} /> Chargement des tickets...</div>
            ) : visibleIssues.length === 0 ? (
              <div className={styles.empty}>
                {issues.length === 0
                  ? 'Aucun ticket trouve dans ces sprints.'
                  : `Tous les tickets de ces sprints sont terminés. Décoche « Masquer les terminés » pour les afficher.`}
              </div>
            ) : (
              <div className={styles.list}>
                {visibleIssues.map(issue => {
                  const alreadyImported = existingJiraKeys.has(issue.key);
                  const isBug = mapIssueType(issue.issueType) === 'bug';
                  return (
                    <label
                      key={issue.id}
                      className={styles.item}
                      style={alreadyImported ? { opacity: 0.55 } : undefined}
                      title={alreadyImported ? 'Ce ticket est déjà dans le board' : undefined}
                    >
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
                      {alreadyImported && (
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-mono)',
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'var(--bg-tertiary, rgba(255,255,255,0.05))',
                            color: 'var(--text-muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          ✓ déjà importé
                        </span>
                      )}
                      {!alreadyImported && isBug && (
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: 'var(--font-mono)',
                            padding: '1px 6px',
                            borderRadius: 'var(--radius-sm)',
                            background: 'rgba(239, 68, 68, 0.15)',
                            color: '#ef4444',
                            whiteSpace: 'nowrap',
                          }}
                          title="Sera placé automatiquement dans le container Anomalie"
                        >
                          → Anomalie
                        </span>
                      )}
                    </label>
                  );
                })}
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
                <Button variant="secondary" onClick={onClose}>Annuler</Button>
                <Button variant="primary" onClick={goToStep2} disabled={selectedSprintIds.size === 0 || loadingIssues}>
                  {loadingIssues ? 'Chargement...' : `Suivant (${selectedSprintIds.size} sprint(s))`}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setStep('sprints')}>Retour</Button>
                <Button variant="primary" onClick={handleImport} disabled={selectedIssueIds.size === 0 || importing}>
                  {importing ? 'Import en cours...' : `Importer (${selectedIssueIds.size})`}
                </Button>
              </>
            )}
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}
