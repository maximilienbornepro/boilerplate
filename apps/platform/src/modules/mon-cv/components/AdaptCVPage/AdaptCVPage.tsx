import { useState, useEffect, useRef } from 'react';
import { ModuleHeader, LoadingSpinner } from '@boilerplate/shared/components';
import type {
  CVData,
  AdaptResponse,
  Project,
  AtsScore,
  AtsRecommendationItem,
  JobAnalysis,
  PipelineTermReplacement,
  ActionItem,
  AnalysisResult,
  PipelineLogEvent,
} from '../../types';
import { adaptCVStream, downloadPDF, getAtsRecommendations, improveCV, createAdaptation, analyzeCVStreamAPI, applyActions } from '../../services/api';
import './AdaptCVPage.css';

// ─── Client-side ATS scoring (mirrors backend scoreCV — pure computation) ─────

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function containsKeyword(text: string, keyword: string): boolean {
  if (!keyword || !text) return false;
  const normText = normalizeText(text);
  const normKw = normalizeText(keyword);

  if (normText.includes(normKw)) return true;

  const kwWords = normKw.split(/\s+/);
  if (kwWords.length < 6) return false;

  const stopWords = new Set(['dans', 'avec', 'pour', 'les', 'des', 'une', 'que', 'sur', 'par', 'est', 'qui', 'son', 'ses', 'aux', 'été', 'bonne', 'minimum', 'expérience', 'connaissance', 'maîtrise', 'environnements']);
  const kwTokens = kwWords.filter(t => t.length >= 4 && !stopWords.has(t));
  if (kwTokens.length < 2) return false;

  const matchCount = kwTokens.filter(t => normText.includes(t)).length;
  return matchCount >= Math.ceil(kwTokens.length * 2 / 3);
}

function extractExperienceText(cv: CVData): string {
  const parts: string[] = [];
  if (cv.title) parts.push(cv.title);
  for (const exp of cv.experiences || []) {
    if (exp.title) parts.push(exp.title);
    for (const m of exp.missions || []) parts.push(m);
    for (const p of exp.projects || []) {
      if (p.title) parts.push(p.title);
      if (p.description) parts.push(p.description);
    }
    for (const t of exp.technologies || []) parts.push(t);
  }
  return parts.join(' ');
}

function extractSkillsText(cv: CVData): string {
  return [
    ...(cv.competences || []),
    ...(cv.outils || []),
    ...(cv.dev || []),
    ...(cv.frameworks || []),
    ...(cv.solutions || []),
  ].join(' ');
}

function computeScoreCV(cv: CVData, jobAnalysis: JobAnalysis): AtsScore {
  const { requiredKeywords, exactJobTitle } = jobAnalysis;
  const expText = extractExperienceText(cv);
  const skillText = extractSkillsText(cv);
  const cvTitleNorm = normalizeText(cv.title || '');
  const jobTitleNorm = normalizeText(exactJobTitle || '');

  const requiredFound: string[] = [];
  const requiredMissing: string[] = [];
  const multiSectionKeywords: string[] = [];
  const singleSectionKeywords: string[] = [];

  for (const kw of requiredKeywords) {
    const inExp = containsKeyword(expText, kw);
    const inSkills = containsKeyword(skillText, kw);
    if (inExp || inSkills) {
      requiredFound.push(kw);
      if (inExp && inSkills) multiSectionKeywords.push(kw);
      else singleSectionKeywords.push(kw);
    } else {
      requiredMissing.push(kw);
    }
  }

  const total = requiredKeywords.length;
  const keywordMatch = total > 0 ? Math.round((requiredFound.length / total) * 100) : 100;
  const sectionCoverage = total > 0 ? Math.round((multiSectionKeywords.length / total) * 100) : 100;
  const titleMatch =
    jobTitleNorm.length > 0 &&
    (cvTitleNorm === jobTitleNorm ||
      cvTitleNorm.includes(jobTitleNorm) ||
      jobTitleNorm.includes(cvTitleNorm));
  const overall = Math.round(
    0.5 * keywordMatch + 0.3 * sectionCoverage + 0.2 * (titleMatch ? 100 : 0)
  );

  return {
    overall,
    keywordMatch,
    sectionCoverage,
    titleMatch,
    breakdown: { requiredFound, requiredMissing, multiSectionKeywords, singleSectionKeywords },
  };
}

interface AdaptCVPageProps {
  cvId: number;
  cvData: CVData;
  onSaved: (adaptationId: number) => void;
  onCancel: () => void;
}

// ─── ATS Score helpers ────────────────────────────────────────────────────────

function getScoreClass(score: number): string {
  if (score >= 75) return 'ats-good';
  if (score >= 50) return 'ats-medium';
  return 'ats-bad';
}

function AtsScoreBlock({
  before,
  after,
}: {
  before: AtsScore;
  after: AtsScore;
}) {
  const delta = after.overall - before.overall;
  const deltaSign = delta > 0 ? '+' : '';
  const totalRequired =
    after.breakdown.requiredFound.length + after.breakdown.requiredMissing.length;

  return (
    <div className="ats-score-block">
      <div className="ats-score-header">Score ATS</div>

      <div className="ats-score-before-after">
        <div className="ats-score-side">
          <div className="ats-score-side-label">Avant</div>
          <div className={`ats-score-value ${getScoreClass(before.overall)}`}>
            {before.overall}%
          </div>
        </div>
        <div className="ats-score-arrow">→</div>
        <div className="ats-score-side">
          <div className="ats-score-side-label">Après</div>
          <div className={`ats-score-value ${getScoreClass(after.overall)}`}>
            {after.overall}%
          </div>
        </div>
        {delta !== 0 && (
          <div className={`ats-score-delta ${delta > 0 ? 'positive' : 'negative'}`}>
            {deltaSign}
            {delta} pts
          </div>
        )}
      </div>

      <div className="ats-score-metrics">
        <div className="ats-score-metric">
          <div className="ats-score-metric-label">
            Mots-clés requis : {after.breakdown.requiredFound.length}/{totalRequired}
          </div>
          <div className="ats-score-bar">
            <div
              className={`ats-score-bar-fill ${getScoreClass(after.keywordMatch)}`}
              style={{ width: `${after.keywordMatch}%` }}
            />
          </div>
          <div className="ats-score-metric-value">{after.keywordMatch}%</div>
        </div>

        <div className="ats-score-metric">
          <div className="ats-score-metric-label">
            Couverture 2 sections : {after.breakdown.multiSectionKeywords.length}/{totalRequired}
          </div>
          <div className="ats-score-bar">
            <div
              className={`ats-score-bar-fill ${getScoreClass(after.sectionCoverage)}`}
              style={{ width: `${after.sectionCoverage}%` }}
            />
          </div>
          <div className="ats-score-metric-value">{after.sectionCoverage}%</div>
        </div>

        <div className="ats-score-metric ats-score-metric-inline">
          <div className="ats-score-metric-label">Titre de poste</div>
          <div className={`ats-score-title-badge ${after.titleMatch ? 'match' : 'no-match'}`}>
            {after.titleMatch ? '✓ Correspond' : '✗ Ne correspond pas'}
          </div>
        </div>
      </div>

      {after.breakdown.requiredMissing.length > 0 && (
        <div className="ats-score-missing">
          <span className="ats-score-missing-label">Manquants : </span>
          {after.breakdown.requiredMissing.map(k => `"${k}"`).join(', ')}
        </div>
      )}
    </div>
  );
}

// ─── Treatment summary (what adaptCV did) ────────────────────────────────────

function TreatmentSummary({
  result,
}: {
  result: AdaptResponse;
}) {
  const { jobAnalysis, changes, atsScore } = result;
  const delta = atsScore.after.overall - atsScore.before.overall;
  const allAddedSkills = Object.entries(changes.addedSkills)
    .flatMap(([cat, skills]) => skills.map(s => `${s} (${cat})`));
  const hasPipelineData = !!(changes.termReplacements || changes.matchedKeywords || changes.remainingGaps);

  return (
    <div className="treatment-summary">
      <div className="treatment-summary__title">Traitements appliques</div>
      <div className="treatment-summary__rows">
        <div className="treatment-row">
          <span className="treatment-row__label">Analyse offre</span>
          <span className="treatment-row__value">
            {jobAnalysis.requiredKeywords.length} mots-cles requis · {jobAnalysis.preferredKeywords.length} preferes · domaine : {jobAnalysis.domain}
          </span>
        </div>
        <div className="treatment-row">
          <span className="treatment-row__label">Titre cible</span>
          <span className="treatment-row__value">"{jobAnalysis.exactJobTitle}"</span>
        </div>

        {hasPipelineData && (
          <>
            <div className="treatment-row">
              <span className="treatment-row__label">Mots-cles trouves</span>
              <span className="treatment-row__value">
                {changes.matchedKeywords?.length || 0} correspondances exactes
              </span>
            </div>
            <div className="treatment-row">
              <span className="treatment-row__label">Synonymes remplaces</span>
              <span className="treatment-row__value">
                {changes.termReplacements?.length || 0} remplacement{(changes.termReplacements?.length || 0) > 1 ? 's' : ''}
              </span>
            </div>
            {changes.titleChange && (
              <div className="treatment-row">
                <span className="treatment-row__label">Titre modifie</span>
                <span className="treatment-row__value">
                  "{changes.titleChange.original}" → "{changes.titleChange.proposed}"
                </span>
              </div>
            )}
            <div className="treatment-row">
              <span className="treatment-row__label">Gaps restants</span>
              <span className="treatment-row__value">
                {changes.remainingGaps?.length || 0} mot{(changes.remainingGaps?.length || 0) > 1 ? 's' : ''}-cle{(changes.remainingGaps?.length || 0) > 1 ? 's' : ''} sans correspondance
              </span>
            </div>
          </>
        )}

        {!hasPipelineData && (
          <>
            <div className="treatment-row">
              <span className="treatment-row__label">Missions generees</span>
              <span className="treatment-row__value">
                {changes.newMissions.length > 0
                  ? `${changes.newMissions.length} mission${changes.newMissions.length > 1 ? 's' : ''} ajoutee${changes.newMissions.length > 1 ? 's' : ''}`
                  : 'aucune'}
              </span>
            </div>
            <div className="treatment-row">
              <span className="treatment-row__label">Projet genere</span>
              <span className="treatment-row__value">
                {changes.newProject ? `"${changes.newProject.title}"` : 'aucun'}
              </span>
            </div>
            <div className="treatment-row">
              <span className="treatment-row__label">Competences ajoutees</span>
              <span className="treatment-row__value">
                {allAddedSkills.length > 0 ? allAddedSkills.join(', ') : 'aucune'}
              </span>
            </div>
          </>
        )}

        <div className="treatment-row treatment-row--score">
          <span className="treatment-row__label">Impact score ATS</span>
          <span className="treatment-row__value">
            {atsScore.before.overall}% → {atsScore.after.overall}%
            {delta !== 0 && (
              <span className={delta > 0 ? 'treatment-delta-pos' : 'treatment-delta-neg'}>
                {' '}{delta > 0 ? '+' : ''}{delta} pts
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Recommendations panel ────────────────────────────────────────────────────

const PRIORITY_ICON: Record<string, string> = {
  critique: '🔴',
  important: '🟡',
  bonus: '🔵',
};

const PRIORITY_LABEL: Record<string, string> = {
  critique: 'Critique',
  important: 'Important',
  bonus: 'Bonus',
};

const TYPE_BADGE: Record<string, string> = {
  add: 'AJOUT',
  replace: 'REMPLACEMENT',
  repeat: 'RÉPÉTITION',
};

function RecommendationsPanel({
  items,
  loading,
  loadingApply,
  onApply,
  prompt,
}: {
  items: AtsRecommendationItem[] | null;
  loading: boolean;
  loadingApply?: boolean;
  onApply?: () => void;
  prompt?: string;
}) {
  if (loading) {
    return (
      <div className="reco-panel">
        <div className="reco-header">💡 Recommandations IA</div>
        <div className="reco-loading">
          <LoadingSpinner size="small" />
          <span>Analyse en cours...</span>
        </div>
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <div className="reco-panel">
        <div className="reco-header">💡 Recommandations IA</div>
        <p className="reco-empty">Aucune recommandation — score optimal !</p>
        {prompt && <PromptCollapsible prompt={prompt} />}
      </div>
    );
  }

  return (
    <div className="reco-panel">
      <div className="reco-header">💡 Recommandations IA</div>
      <div className="reco-list">
        {items.map((item, idx) => (
          <div key={idx} className={`reco-item reco-priority-${item.priority}`}>
            <div className="reco-item-title">
              <span className="reco-icon">{PRIORITY_ICON[item.priority] || '🔵'}</span>
              <span className="reco-priority-badge">{PRIORITY_LABEL[item.priority]}</span>
              {item.type && (
                <span className={`reco-type-badge reco-type-${item.type}`}>
                  {TYPE_BADGE[item.type] || item.type}
                </span>
              )}
              <span className="reco-action">{item.action}</span>
            </div>
            {item.example && <div className="reco-example">→ {item.example}</div>}
            {item.type === 'replace' && item.termToFind && item.termToReplace && (
              <div className="reco-replace-detail">
                <span className="reco-replace-find">"{item.termToFind}"</span>
                <span className="reco-replace-arrow"> ⟶ </span>
                <span className="reco-replace-with">"{item.termToReplace}"</span>
                <span className="reco-replace-scope"> dans tout le CV</span>
              </div>
            )}
            {item.keywords.length > 0 && (
              <div className="reco-keywords">
                {item.keywords.map(k => (
                  <span key={k} className="reco-keyword-tag">
                    "{k}"
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {onApply && (
        <div className="reco-apply-row">
          <button
            className="btn-apply-reco"
            onClick={onApply}
            disabled={loadingApply}
          >
            {loadingApply ? (
              <>
                <LoadingSpinner size="small" />
                <span>Génération en cours...</span>
              </>
            ) : (
              '✦ Générer et appliquer les améliorations'
            )}
          </button>
          <p className="reco-apply-hint">
            Claude va générer le contenu exact pour chaque recommandation et l'ajouter aux champs éditables.
          </p>
        </div>
      )}

      {prompt && <PromptCollapsible prompt={prompt} />}
    </div>
  );
}

// ─── Prompt collapsible (transparence — affiche le prompt envoyé à Claude) ────

function PromptCollapsible({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="reco-prompt-block">
      <button className="reco-prompt-toggle" onClick={() => setOpen(o => !o)}>
        {open ? '▲' : '▼'} Voir le prompt envoyé à Claude
      </button>
      {open && (
        <pre className="reco-prompt-text">{prompt}</pre>
      )}
    </div>
  );
}

// ─── Action Card (for 2-step analysis flow) ─────────────────────────────────

function ActionCard({ action, selected, onToggle }: { action: ActionItem; selected: boolean; onToggle: (id: string) => void }) {
  return (
    <div className={`action-card ${selected ? 'action-card--selected' : ''} action-card--${action.impact} action-card--${action.type}`}>
      <label className="action-card-check">
        <input type="checkbox" checked={selected} onChange={() => onToggle(action.id)} />
      </label>
      <div className="action-card-content">
        {action.experienceContext && (
          <div className="action-card-context">{action.experienceContext}</div>
        )}
        {action.type === 'replace' && (
          <div className="action-card-replacement">
            <span className="action-card-old">{'\u00AB'} {action.cvTerm} {'\u00BB'}</span>
            <span className="action-card-arrow">{'\u2192'}</span>
            <span className="action-card-new">{'\u00AB'} {action.offerTerm} {'\u00BB'}</span>
          </div>
        )}
        {action.type === 'title_change' && (
          <>
            <div className="action-card-replacement">
              <span className="action-card-old">{'\u00AB'} {action.cvTerm} {'\u00BB'}</span>
              <span className="action-card-arrow">{'\u2192'}</span>
              <span className="action-card-new">{'\u00AB'} {action.offerTerm} {'\u00BB'}</span>
            </div>
            <div className="action-card-type">Changement de titre</div>
          </>
        )}
        {action.type === 'add_skill' && (
          <div className="action-card-add">
            <span className="action-card-badge action-card-badge--skill">+ {action.skillCategory}</span>
            <span className="action-card-new">{'\u00AB'} {action.offerTerm} {'\u00BB'}</span>
          </div>
        )}
        {action.type === 'add_project' && (
          <div className="action-card-add">
            <span className="action-card-badge action-card-badge--mission">+ mission</span>
            <div className="action-card-suggested">{action.suggestedText}</div>
          </div>
        )}
      </div>
      <div className="action-card-meta">
        <span className="action-card-confidence">{Math.round(action.confidence * 100)}%</span>
        <span className="action-card-gain">+{action.scoreGain}pts</span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AdaptCVPage({ cvId, cvData, onSaved, onCancel }: AdaptCVPageProps) {
  const [jobOffer, setJobOffer] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPDF, setLoadingPDF] = useState(false);
  const [loadingReco, setLoadingReco] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AdaptResponse | null>(null);

  // Editable state for generated content
  const [editableTitle, setEditableTitle] = useState<string>(cvData.title || '');
  const [editableMissions, setEditableMissions] = useState<string[]>([]);
  const [editableProject, setEditableProject] = useState<Project | undefined>(undefined);
  const [editableSkills, setEditableSkills] = useState<Record<string, string[]>>({});
  const [termReplacements, setTermReplacements] = useState<Array<{ find: string; replaceWith: string }>>([]);

  // Pipeline-specific state
  const [pipelineReplacements, setPipelineReplacements] = useState<PipelineTermReplacement[]>([]);
  const [matchedKeywords, setMatchedKeywords] = useState<string[]>([]);
  const [remainingGaps, setRemainingGaps] = useState<string[]>([]);

  // Live ATS score (starts as result.atsScore.after, updated in real-time on edits)
  const [liveScore, setLiveScore] = useState<AtsScore | null>(null);

  // Cached job analysis for client-side real-time scoring (no AI round-trip)
  const [jobAnalysis, setJobAnalysis] = useState<JobAnalysis | null>(null);

  // Pipeline logs state
  const [pipelineLogs, setPipelineLogs] = useState<PipelineLogEvent[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Analysis state (2-step flow)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  // Recommendation state
  const [showReco, setShowReco] = useState(false);
  const [recoItems, setRecoItems] = useState<AtsRecommendationItem[] | null>(null);
  const [recoPrompt, setRecoPrompt] = useState<string | undefined>(undefined);

  // ── Real-time score recomputation (debounced, pure client-side) ──────────────

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobAnalysis) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const currentCV = buildEditedCV();
      setLiveScore(computeScoreCV(currentCV, jobAnalysis));
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableMissions, editableProject, editableSkills, jobAnalysis]);

  // Auto-scroll pipeline logs
  useEffect(() => {
    if (logsEndRef.current && showLogs) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [pipelineLogs, showLogs]);

  // ── Build current edited CV ──────────────────────────────────────────────────

  const buildEditedCV = (): CVData => {
    // When we have a result, use the adapted CV as base
    // (it already has synonyms replaced + skills/missions added). Otherwise start from original.
    const baseCV = result ? result.adaptedCV : cvData;
    const cv: CVData = JSON.parse(JSON.stringify(baseCV));

    // Apply title change
    cv.title = editableTitle;

    // Apply term replacements to all missions across all experiences (legacy improve flow)
    if (termReplacements.length > 0) {
      for (const exp of cv.experiences || []) {
        exp.missions = exp.missions.map(m => {
          let updated = m;
          for (const { find, replaceWith } of termReplacements) {
            updated = updated.replace(
              new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
              replaceWith
            );
          }
          return updated;
        });
      }
    }

    if (cv.experiences && cv.experiences.length > 0) {
      cv.experiences[0].missions = [...cv.experiences[0].missions, ...editableMissions];
      if (editableProject) {
        cv.experiences[0].projects = [editableProject, ...cv.experiences[0].projects];
      }
    }
    for (const [cat, skills] of Object.entries(editableSkills)) {
      const key = cat as keyof CVData;
      const existing = (cv[key] as string[]) || [];
      (cv[key] as string[]) = [...existing, ...skills].sort((a, b) =>
        a.localeCompare(b, 'fr', { sensitivity: 'base' })
      );
    }
    return cv;
  };

  // ── Adaptation ──────────────────────────────────────────────────────────────

  const handleAdapt = async () => {
    if (!jobOffer.trim()) {
      setError("Veuillez saisir le texte de l'offre d'emploi");
      return;
    }
    setLoading(true);
    setError('');
    setShowReco(false);
    setRecoItems(null);
    setPipelineLogs([]);
    setShowLogs(true);
    try {
      const response = await adaptCVStream(
        cvData,
        jobOffer,
        (event) => setPipelineLogs(prev => [...prev, event]),
        customInstructions || undefined,
      );
      setResult(response);
      setJobAnalysis(response.jobAnalysis);
      setLiveScore(response.atsScore.after);
      setEditableMissions([...response.changes.newMissions]);
      setEditableProject(
        response.changes.newProject ? { ...response.changes.newProject } : undefined
      );
      const skillsCopy: Record<string, string[]> = {};
      for (const [cat, skills] of Object.entries(response.changes.addedSkills)) {
        skillsCopy[cat] = [...skills];
      }
      setEditableSkills(skillsCopy);

      // Pipeline-specific data
      if (response.changes.termReplacements) {
        setPipelineReplacements([...response.changes.termReplacements]);
      }
      if (response.changes.matchedKeywords) {
        setMatchedKeywords([...response.changes.matchedKeywords]);
      }
      if (response.changes.remainingGaps) {
        setRemainingGaps([...response.changes.remainingGaps]);
      }
      // Apply title change from pipeline
      if (response.changes.titleChange?.proposed) {
        setEditableTitle(response.changes.titleChange.proposed);
      }
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'adaptation du CV");
    } finally {
      setLoading(false);
    }
  };

  // ── Analysis (2-step flow) ───────────────────────────────────────────────────

  const toggleAction = (id: string) => {
    setSelectedActionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAnalyze = async () => {
    if (!jobOffer.trim()) return;
    setLoading(true);
    setError('');
    setPipelineLogs([]);
    setShowLogs(true);
    setAnalysis(null);
    setResult(null);
    try {
      const analysisResult = await analyzeCVStreamAPI(cvData, jobOffer, (event) => {
        setPipelineLogs(prev => [...prev, event]);
      });
      setAnalysis(analysisResult);
      setSelectedActionIds(new Set(analysisResult.actions.map(a => a.id)));
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'analyse');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyActions = async () => {
    if (!analysis || selectedActionIds.size === 0) return;
    setApplying(true);
    setError('');
    try {
      const selectedActions = analysis.actions.filter(a => selectedActionIds.has(a.id));
      const { adaptedCV, replacements, scoreAfter } = await applyActions(cvData, selectedActions, analysis.jobAnalysis);

      // Save adaptation directly — no intermediate result page
      const savedAdaptation = await createAdaptation(cvId, {
        jobOffer,
        adaptedCv: adaptedCV,
        changes: {
          newMissions: selectedActions.filter(a => a.type === 'add_project').map(a => a.suggestedText || ''),
          addedSkills: Object.fromEntries(
            selectedActions.filter(a => a.type === 'add_skill' && a.skillCategory)
              .reduce((acc, a) => {
                const cat = a.skillCategory!;
                if (!acc.has(cat)) acc.set(cat, []);
                acc.get(cat)!.push(a.offerTerm);
                return acc;
              }, new Map<string, string[]>())
          ),
          termReplacements: replacements.map(r => ({
            section: r.section,
            cvTerm: r.cvTerm,
            offerTerm: r.offerTerm,
            originalText: r.originalText,
            replacedText: r.replacedText,
          })),
        },
        atsBefore: analysis.score,
        atsAfter: scoreAfter,
        jobAnalysis: analysis.jobAnalysis,
      });
      onSaved(savedAdaptation.id);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'application');
    } finally {
      setApplying(false);
    }
  };

  // ── Validate with edited content — persists as a new adaptation ────────────

  const [loadingValidate, setLoadingValidate] = useState(false);

  const handleValidate = async () => {
    if (!result) return;
    setLoadingValidate(true);
    setError('');
    try {
      const adaptedCv = buildEditedCV();
      const savedAdaptation = await createAdaptation(cvId, {
        jobOffer,
        adaptedCv,
        changes: {
          newMissions: editableMissions,
          newProject: editableProject,
          addedSkills: editableSkills,
        },
        atsBefore: result.atsScore.before,
        atsAfter: liveScore ?? result.atsScore.after,
        jobAnalysis: result.jobAnalysis,
      });
      onSaved(savedAdaptation.id);
    } catch (err: any) {
      setError(err.message || "Erreur lors de la sauvegarde de l'adaptation");
    } finally {
      setLoadingValidate(false);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setAnalysis(null);
    setSelectedActionIds(new Set());
    setApplying(false);
    setError('');
    setShowReco(false);
    setRecoItems(null);
    setRecoPrompt(undefined);
    setLiveScore(null);
    setJobAnalysis(null);
    setEditableTitle(cvData.title || '');
    setTermReplacements([]);
    setPipelineReplacements([]);
    setMatchedKeywords([]);
    setRemainingGaps([]);
    setPipelineLogs([]);
    setShowLogs(false);
  };

  // ── PDF download ─────────────────────────────────────────────────────────────

  const handleDownloadPDF = async () => {
    setLoadingPDF(true);
    setError('');
    try {
      const finalCV = buildEditedCV();
      const filename = `CV_adapte_${cvData.name || 'CV'}.pdf`;
      await downloadPDF(finalCV, filename);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du téléchargement du PDF');
    } finally {
      setLoadingPDF(false);
    }
  };

  // ── Recommendations ──────────────────────────────────────────────────────────

  const handleGetRecommendations = async (cvToAnalyze: CVData) => {
    setLoadingReco(true);
    setShowReco(true);
    setRecoItems(null);
    setRecoPrompt(undefined);
    try {
      const reco = await getAtsRecommendations(cvToAnalyze, jobOffer);
      setRecoItems(reco.recommendations);
      setRecoPrompt(reco.promptUsed);
      // currentScore reflects the CV state at analysis time
      setLiveScore(reco.currentScore);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la génération des recommandations');
      setShowReco(false);
    } finally {
      setLoadingReco(false);
    }
  };

  // ── Apply improvements (second-pass targeted generation) ─────────────────────

  const handleApplyImprovements = async () => {
    setLoadingApply(true);
    setError('');
    try {
      const currentCV = buildEditedCV();
      const improvement = await improveCV(currentCV, jobOffer);

      // Apply title change (the main bug fix)
      if (improvement.titleChange) {
        setEditableTitle(improvement.titleChange);
      }

      // Apply term replacements to existing missions
      if (improvement.termReplacements.length > 0) {
        setTermReplacements(prev => {
          const merged = [...prev];
          for (const rep of improvement.termReplacements) {
            if (!merged.some(r => r.find.toLowerCase() === rep.find.toLowerCase())) {
              merged.push(rep);
            }
          }
          return merged;
        });
      }

      // Merge additional missions
      if (improvement.additionalMissions.length > 0) {
        setEditableMissions(prev => [...prev, ...improvement.additionalMissions]);
      }

      // Merge additional skills
      if (Object.keys(improvement.additionalSkills).length > 0) {
        setEditableSkills(prev => {
          const updated = { ...prev };
          for (const [cat, skills] of Object.entries(improvement.additionalSkills)) {
            if (skills.length > 0) {
              updated[cat] = [...(updated[cat] || []), ...skills];
            }
          }
          return updated;
        });
      }

      // Update live ATS score
      setLiveScore(improvement.scoreAfter);

      // Refresh recommendations based on the new state
      setRecoItems(null);
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'amélioration");
    } finally {
      setLoadingApply(false);
    }
  };

  // ── Editable helpers ─────────────────────────────────────────────────────────

  const updateMission = (idx: number, value: string) => {
    setEditableMissions(prev => prev.map((m, i) => (i === idx ? value : m)));
  };

  const removeMission = (idx: number) => {
    setEditableMissions(prev => prev.filter((_, i) => i !== idx));
  };

  const removeSkill = (cat: string, skillIdx: number) => {
    setEditableSkills(prev => {
      const updated = { ...prev };
      updated[cat] = prev[cat].filter((_, i) => i !== skillIdx);
      if (updated[cat].length === 0) delete updated[cat];
      return updated;
    });
  };

  const updateSkill = (cat: string, skillIdx: number, value: string) => {
    setEditableSkills(prev => {
      const updated = { ...prev };
      updated[cat] = prev[cat].map((s, i) => i === skillIdx ? value : s);
      return updated;
    });
  };

  // ── Result view ──────────────────────────────────────────────────────────────

  if (result) {
    const scoreBefore = result.atsScore.before;
    const scoreAfter = liveScore ?? result.atsScore.after;

    return (
      <>
        <ModuleHeader title="Résultat de l'adaptation" onBack={handleRetry}>
          <button
            className="module-header-btn"
            onClick={handleDownloadPDF}
            disabled={loadingPDF || loadingValidate}
          >
            {loadingPDF ? '...' : '↓ PDF'}
          </button>
          <button
            className="module-header-btn module-header-btn-primary"
            onClick={handleValidate}
            disabled={loadingValidate || loadingPDF}
          >
            {loadingValidate ? 'Sauvegarde...' : '✓ Sauvegarder'}
          </button>
        </ModuleHeader>
        <div className="adapt-page">

        <div className="adapt-result">
          <AtsScoreBlock before={scoreBefore} after={scoreAfter} />

          <TreatmentSummary result={result} />

          {/* ── Pipeline results: keywords, replacements, gaps ──────────────── */}
          {(matchedKeywords.length > 0 || pipelineReplacements.length > 0 || remainingGaps.length > 0) && (
            <div className="pipeline-results">
              <h3>Analyse des correspondances</h3>

              {/* Matched keywords */}
              {matchedKeywords.length > 0 && (
                <div className="pipeline-section">
                  <h4>Mots-cles trouves ({matchedKeywords.length})</h4>
                  <div className="pipeline-tags">
                    {matchedKeywords.map(kw => (
                      <span key={kw} className="pipeline-tag pipeline-tag--match">{kw}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Pipeline term replacements (before/after cards) */}
              {pipelineReplacements.length > 0 && (
                <div className="pipeline-section">
                  <h4>Remplacements de synonymes ({pipelineReplacements.length})</h4>
                  <div className="pipeline-replacements">
                    {pipelineReplacements.map((rep, idx) => (
                      <div key={idx} className="pipeline-replacement-card">
                        <div className="pipeline-replacement-header">
                          <span className="pipeline-replacement-section">{rep.section}</span>
                          <span className="pipeline-replacement-confidence">
                            {Math.round(rep.confidence * 100)}%
                          </span>
                        </div>
                        <div className="pipeline-replacement-diff">
                          <div className="pipeline-replacement-before">
                            <span className="pipeline-diff-label">Avant</span>
                            <span className="pipeline-diff-text pipeline-diff-text--old">{rep.cvTerm}</span>
                          </div>
                          <span className="pipeline-replacement-arrow">→</span>
                          <div className="pipeline-replacement-after">
                            <span className="pipeline-diff-label">Apres</span>
                            <span className="pipeline-diff-text pipeline-diff-text--new">{rep.offerTerm}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Remaining gaps */}
              {remainingGaps.length > 0 && (
                <div className="pipeline-section">
                  <h4>Mots-cles sans correspondance ({remainingGaps.length})</h4>
                  <div className="pipeline-tags">
                    {remainingGaps.map(kw => (
                      <span key={kw} className="pipeline-tag pipeline-tag--gap">{kw}</span>
                    ))}
                  </div>
                  <p className="pipeline-hint">
                    Ces mots-clés n'ont pas pu être couverts par les modifications appliquées.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="adapt-changes">
            <h3>Modifications apportees — editables</h3>

            {/* Titre du poste — toujours éditable */}
            <div className="change-section">
              <h4>
                Titre du poste
                {editableTitle !== cvData.title && (
                  <span className="change-section-badge change-section-badge--modified">modifié</span>
                )}
              </h4>
              <div className="editable-title-row">
                <input
                  className="editable-input"
                  type="text"
                  value={editableTitle}
                  onChange={e => setEditableTitle(e.target.value)}
                  placeholder="Titre du poste"
                />
                {editableTitle !== cvData.title && (
                  <button
                    className="btn-icon-remove"
                    onClick={() => setEditableTitle(cvData.title || '')}
                    title="Rétablir le titre original"
                  >
                    ↩
                  </button>
                )}
              </div>
              {editableTitle !== cvData.title && (
                <div className="editable-title-diff">
                  <span className="diff-original">{cvData.title}</span>
                  <span className="diff-arrow"> → </span>
                  <span className="diff-new">{editableTitle}</span>
                </div>
              )}
            </div>

            {/* Remplacements de termes */}
            {termReplacements.length > 0 && (
              <div className="change-section">
                <h4>Remplacements de termes <span className="change-section-badge change-section-badge--replace">dans tout le CV</span></h4>
                <div className="term-replacements-list">
                  {termReplacements.map((rep, idx) => (
                    <div key={idx} className="term-replacement-row">
                      <span className="term-find">"{rep.find}"</span>
                      <span className="term-arrow"> ⟶ </span>
                      <span className="term-replace">"{rep.replaceWith}"</span>
                      <button
                        className="btn-icon-remove"
                        onClick={() => setTermReplacements(prev => prev.filter((_, i) => i !== idx))}
                        title="Annuler ce remplacement"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editableMissions.length > 0 && (
              <div className="change-section">
                <h4>Nouvelles missions</h4>
                {editableMissions.map((mission, idx) => (
                  <div key={idx} className="editable-mission-row">
                    <div className="editable-mission-header">
                      <span className="editable-mission-num">Mission {idx + 1}</span>
                      <button
                        className="btn-icon-remove"
                        onClick={() => removeMission(idx)}
                        title="Supprimer cette mission"
                      >
                        × Supprimer
                      </button>
                    </div>
                    <textarea
                      className="editable-textarea"
                      value={mission}
                      onChange={e => updateMission(idx, e.target.value)}
                      onInput={e => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }}
                      rows={4}
                    />
                  </div>
                ))}
              </div>
            )}

            {editableProject !== undefined && (
              <div className="change-section">
                <h4>Nouveau projet</h4>
                <div className="editable-project-fields">
                  <div className="editable-field-group">
                    <label>Titre</label>
                    <input
                      type="text"
                      className="editable-input"
                      value={editableProject.title}
                      onChange={e =>
                        setEditableProject(p => (p ? { ...p, title: e.target.value } : p))
                      }
                    />
                  </div>
                  <div className="editable-field-group">
                    <label>Description</label>
                    <textarea
                      className="editable-textarea"
                      value={editableProject.description || ''}
                      onChange={e =>
                        setEditableProject(p =>
                          p ? { ...p, description: e.target.value } : p
                        )
                      }
                      onInput={e => {
                        const el = e.currentTarget;
                        el.style.height = 'auto';
                        el.style.height = `${el.scrollHeight}px`;
                      }}
                      rows={5}
                    />
                  </div>
                  <button
                    className="btn-remove-project"
                    onClick={() => setEditableProject(undefined)}
                  >
                    × Supprimer ce projet
                  </button>
                </div>
              </div>
            )}

            {Object.keys(editableSkills).length > 0 && (
              <div className="change-section">
                <h4>Compétences ajoutées</h4>
                <div className="editable-skills-row">
                  {Object.entries(editableSkills).map(([category, skills]) =>
                    skills.map((skill, idx) => (
                      <div key={`${category}-${idx}`} className="editable-skill-tag">
                        <span className="editable-skill-cat">{category}</span>
                        <input
                          className="editable-skill-input"
                          value={skill}
                          onChange={e => updateSkill(category, idx, e.target.value)}
                          size={Math.max(skill.length, 4)}
                        />
                        <button
                          className="editable-skill-remove"
                          onClick={() => removeSkill(category, idx)}
                          title="Supprimer"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {editableMissions.length === 0 &&
              editableProject === undefined &&
              Object.keys(editableSkills).length === 0 && (
                <p className="no-changes">Aucune modification significative apportee.</p>
              )}
          </div>

          {showReco && (
            <RecommendationsPanel
              items={recoItems}
              loading={loadingReco}
              loadingApply={loadingApply}
              onApply={handleApplyImprovements}
              prompt={recoPrompt}
            />
          )}

          {error && <div className="adapt-error">{error}</div>}

          {remainingGaps.length > 0 && (
            <div className="adapt-actions">
              <button
                className="btn btn-reco"
                onClick={() => handleGetRecommendations(buildEditedCV())}
                disabled={loadingReco || loadingApply}
              >
                {loadingReco ? (
                  <>
                    <LoadingSpinner size="small" />
                    <span>Analyse...</span>
                  </>
                ) : (
                  '💡 Analyser les gaps'
                )}
              </button>
            </div>
          )}
        </div>
        </div>
      </>
    );
  }

  // ── Analysis view (2-step flow: between form and result) ─────────────────────

  if (analysis && !result) {
    const estimatedScore = (() => {
      const selected = analysis.actions.filter(a => selectedActionIds.has(a.id));
      const gain = selected.reduce((sum, a) => sum + a.scoreGain, 0);
      return Math.min(100, analysis.score.overall + gain);
    })();

    const nonCriticalActions = analysis.targetScore100.actions.filter(a => a.impact !== 'critical');
    const replaceActions = analysis.actions.filter(a => a.type === 'replace' || a.type === 'title_change');
    const skillActions = analysis.actions.filter(a => a.type === 'add_skill');
    const missionActions = analysis.actions.filter(a => a.type === 'add_project');

    return (
      <>
        <ModuleHeader title="Analyse ATS" onBack={handleRetry}>
          <button
            className="module-header-btn module-header-btn-primary"
            onClick={handleApplyActions}
            disabled={applying || selectedActionIds.size === 0}
          >
            {applying ? 'Application...' : `Appliquer (${selectedActionIds.size})`}
          </button>
        </ModuleHeader>
        <div className="adapt-page">
          <div className="adapt-analysis">

            {/* Current score */}
            <div className="analysis-score-current">
              <div className={`analysis-score-value ${getScoreClass(analysis.score.overall)}`}>
                {analysis.score.overall}%
              </div>
              <div className="analysis-score-label">Score ATS actuel</div>
            </div>

            {/* Keywords summary */}
            <div className="analysis-keywords">
              <div className="analysis-kw-section">
                <h4>Trouvés ({analysis.matchedKeywords.length})</h4>
                <div className="analysis-tags">
                  {analysis.matchedKeywords.map(kw => (
                    <span key={kw} className="analysis-tag analysis-tag--match">{kw}</span>
                  ))}
                </div>
              </div>
              {analysis.synonymsFound.length > 0 && (
                <div className="analysis-kw-section">
                  <h4>Synonymes détectés ({analysis.synonymsFound.length})</h4>
                  <div className="analysis-tags">
                    {analysis.synonymsFound.map(kw => (
                      <span key={kw} className="analysis-tag analysis-tag--synonym">{kw}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="analysis-kw-section">
                <h4>Non couverts ({analysis.gaps.length})</h4>
                <div className="analysis-tags">
                  {analysis.gaps.map(kw => (
                    <span key={kw} className="analysis-tag analysis-tag--gap">{kw}</span>
                  ))}
                </div>
              </div>
            </div>

            {/* Synonym replacements */}
            {replaceActions.length > 0 && (
              <div className="analysis-target">
                <div className="analysis-target-header">
                  <h3>Synonymes à remplacer ({replaceActions.length})</h3>
                </div>
                {replaceActions.map(action => (
                  <ActionCard key={action.id} action={action} selected={selectedActionIds.has(action.id)} onToggle={toggleAction} />
                ))}
              </div>
            )}

            {/* Skill additions */}
            {skillActions.length > 0 && (
              <div className="analysis-target">
                <div className="analysis-target-header">
                  <h3>Compétences à ajouter ({skillActions.length})</h3>
                </div>
                {skillActions.map(action => (
                  <ActionCard key={action.id} action={action} selected={selectedActionIds.has(action.id)} onToggle={toggleAction} />
                ))}
              </div>
            )}

            {/* Mission additions */}
            {missionActions.length > 0 && (
              <div className="analysis-target">
                <div className="analysis-target-header">
                  <h3>Missions à ajouter ({missionActions.length})</h3>
                </div>
                {missionActions.map(action => (
                  <ActionCard key={action.id} action={action} selected={selectedActionIds.has(action.id)} onToggle={toggleAction} />
                ))}
              </div>
            )}

            {/* Estimated score after selection */}
            <div className="analysis-estimated">
              <div className="analysis-estimated-label">Score estimé après application</div>
              <div className={`analysis-estimated-value ${getScoreClass(estimatedScore)}`}>
                {estimatedScore}%
              </div>
              <div className="analysis-estimated-count">
                {selectedActionIds.size} action{selectedActionIds.size > 1 ? 's' : ''} sélectionnée{selectedActionIds.size > 1 ? 's' : ''}
              </div>
            </div>

            {/* Apply button (bottom) */}
            <div className="adapt-actions">
              <button
                className="btn btn-primary"
                onClick={handleApplyActions}
                disabled={applying || selectedActionIds.size === 0}
              >
                {applying ? (
                  <>
                    <LoadingSpinner size="small" />
                    <span>Application en cours...</span>
                  </>
                ) : (
                  `Appliquer les modifications sélectionnées (${selectedActionIds.size})`
                )}
              </button>
              <button className="btn btn-outline" onClick={handleRetry} disabled={applying}>
                Recommencer
              </button>
            </div>

            {error && <div className="adapt-error">{error}</div>}

            {/* Pipeline logs */}
            {pipelineLogs.length > 0 && (
              <div className="pipeline-logs-panel">
                <button
                  className="pipeline-logs-toggle"
                  onClick={() => setShowLogs(!showLogs)}
                >
                  {showLogs ? '\u25BC' : '\u25B6'} Pipeline ({pipelineLogs.filter(l => l.type === 'step' && l.status === 'completed').length}/{pipelineLogs.some(l => l.type === 'step' && l.step === 4) ? 4 : 3} étapes)
                </button>
                {showLogs && (
                  <div className="pipeline-logs-content">
                    {pipelineLogs.map((log, idx) => (
                      <div key={idx} className={`pipeline-log-entry pipeline-log-${log.type}`}>
                        {log.type === 'step' && log.status === 'running' && (
                          <span className="pipeline-log-icon">{'\u23F3'}</span>
                        )}
                        {log.type === 'step' && log.status === 'completed' && (
                          <span className="pipeline-log-icon">{'\u2705'}</span>
                        )}
                        {log.type === 'step' && log.status === 'error' && (
                          <span className="pipeline-log-icon">{'\u274C'}</span>
                        )}
                        {log.type === 'log' && (
                          <span className="pipeline-log-icon">  {'\u2192'}</span>
                        )}
                        {log.type === 'error' && (
                          <span className="pipeline-log-icon">{'\u274C'}</span>
                        )}
                        <span className="pipeline-log-message">
                          {log.type === 'step' && log.status === 'running' && `Étape ${log.step}: ${log.name}...`}
                          {log.type === 'step' && log.status === 'completed' && `Étape ${log.step}: ${log.name} (${log.durationMs}ms)`}
                          {log.type === 'step' && log.status === 'error' && `Étape ${log.step}: ${log.name} — ERREUR`}
                          {log.type === 'log' && log.message}
                          {log.type === 'error' && log.message}
                        </span>
                      </div>
                    ))}
                    <div ref={logsEndRef} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // ── Form view ────────────────────────────────────────────────────────────────

  return (
    <>
      <ModuleHeader title="Analyse ATS" onBack={onCancel} />
      <div className="adapt-page">
      <div className="adapt-form">
        <div className="form-section">
          <label htmlFor="jobOffer">Offre d'emploi *</label>
          <textarea
            id="jobOffer"
            value={jobOffer}
            onChange={e => setJobOffer(e.target.value)}
            placeholder="Collez ici le texte complet de l'offre d'emploi..."
            rows={12}
            disabled={loading}
          />
          <p className="form-hint">
            Copiez-collez le texte de l'offre d'emploi. L'IA analysera les mots-clés ATS exacts
            et adaptera votre CV en conséquence.
          </p>
        </div>

        {error && <div className="adapt-error">{error}</div>}

        <div className="adapt-actions">
          <button
            className="btn btn-primary"
            onClick={handleAnalyze}
            disabled={loading || !jobOffer.trim()}
          >
            {loading ? (
              <>
                <LoadingSpinner size="small" />
                <span>Analyse en cours...</span>
              </>
            ) : (
              'Adapter automatiquement'
            )}
          </button>
          <button
            className="btn btn-reco"
            onClick={() => handleGetRecommendations(cvData)}
            disabled={loading || loadingReco || !jobOffer.trim()}
            title="Analyser le CV actuel vs l'offre sans l'adapter"
          >
            {loadingReco ? (
              <>
                <LoadingSpinner size="small" />
                <span>Analyse...</span>
              </>
            ) : (
              '💡 Analyser & recommander'
            )}
          </button>
          <button className="btn btn-outline" onClick={onCancel} disabled={loading}>
            Annuler
          </button>
        </div>

        {/* Pipeline Logs — visible during AND after analysis */}
        {pipelineLogs.length > 0 && (
          <div className="pipeline-logs-panel pipeline-logs-panel--form">
            <button
              className="pipeline-logs-toggle"
              onClick={() => setShowLogs(!showLogs)}
            >
              {showLogs ? '\u25BC' : '\u25B6'} Pipeline ({pipelineLogs.filter(l => l.type === 'step' && l.status === 'completed').length}/3 étapes)
              {loading && ' — en cours...'}
            </button>
            {showLogs && (
              <div className="pipeline-logs-content">
                {pipelineLogs.map((log, idx) => (
                  <div key={idx} className={`pipeline-log-entry pipeline-log-${log.type}`}>
                    {log.type === 'step' && log.status === 'running' && (
                      <span className="pipeline-log-icon">{'\u23F3'}</span>
                    )}
                    {log.type === 'step' && log.status === 'completed' && (
                      <span className="pipeline-log-icon">{'\u2705'}</span>
                    )}
                    {log.type === 'step' && log.status === 'error' && (
                      <span className="pipeline-log-icon">{'\u274C'}</span>
                    )}
                    {log.type === 'log' && (
                      <span className="pipeline-log-icon">  {'\u2192'}</span>
                    )}
                    {log.type === 'error' && (
                      <span className="pipeline-log-icon">{'\u274C'}</span>
                    )}
                    <span className="pipeline-log-message">
                      {log.type === 'step' && log.status === 'running' && `Étape ${log.step}: ${log.name}...`}
                      {log.type === 'step' && log.status === 'completed' && `Étape ${log.step}: ${log.name} (${log.durationMs}ms)`}
                      {log.type === 'step' && log.status === 'error' && `Étape ${log.step}: ${log.name} — ERREUR`}
                      {log.type === 'log' && log.message}
                      {log.type === 'error' && log.message}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            )}
          </div>
        )}

        <div className="adapt-info-grid">
          <div className="adapt-info adapt-info--adapt">
            <h4>Adapter automatiquement</h4>
            <ul>
              <li>L'IA analyse l'offre pour extraire les mots-clés ATS <em>exacts</em> (token-exact)</li>
              <li>Les synonymes et paraphrases sont détectés automatiquement</li>
              <li>Vous choisissez quels remplacements appliquer</li>
              <li>Score ATS avant/après calculé (modèle Jobscan)</li>
              <li>Les modifications sont prévisualisées avant application</li>
            </ul>
          </div>
          <div className="adapt-info adapt-info--reco">
            <h4>💡 Analyser &amp; recommander</h4>
            <ul>
              <li>Analyse les gaps entre votre CV et l'offre <em>sans modifier le CV</em></li>
              <li>Liste les mots-clés ATS manquants dans votre profil</li>
              <li>Propose des recommandations ciblées (ajout, remplacement, répétition)</li>
              <li>Score ATS calculé sur votre CV actuel</li>
              <li>Vous appliquez chaque recommandation à la carte</li>
            </ul>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
