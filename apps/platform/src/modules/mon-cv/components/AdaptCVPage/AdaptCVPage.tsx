import { useState, useEffect, useRef } from 'react';
import { ModuleHeader, LoadingSpinner } from '@boilerplate/shared/components';
import type {
  CVData,
  AdaptResponse,
  Project,
  AtsScore,
  AtsRecommendationItem,
  JobAnalysis,
} from '../../types';
import { adaptCV, downloadPDF, getAtsRecommendations, improveCV, createAdaptation } from '../../services/api';
import './AdaptCVPage.css';

// ─── Client-side ATS scoring (mirrors backend scoreCV — pure computation) ─────

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function containsKeyword(text: string, keyword: string): boolean {
  if (!keyword || !text) return false;
  return normalizeText(text).includes(normalizeText(keyword));
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

function RecommendationsPanel({
  items,
  loading,
  loadingApply,
  onApply,
}: {
  items: AtsRecommendationItem[] | null;
  loading: boolean;
  loadingApply?: boolean;
  onApply?: () => void;
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
              <span className="reco-action">{item.action}</span>
            </div>
            {item.example && <div className="reco-example">→ {item.example}</div>}
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
  const [editableMissions, setEditableMissions] = useState<string[]>([]);
  const [editableProject, setEditableProject] = useState<Project | undefined>(undefined);
  const [editableSkills, setEditableSkills] = useState<Record<string, string[]>>({});

  // Live ATS score (starts as result.atsScore.after, updated in real-time on edits)
  const [liveScore, setLiveScore] = useState<AtsScore | null>(null);

  // Cached job analysis for client-side real-time scoring (no AI round-trip)
  const [jobAnalysis, setJobAnalysis] = useState<JobAnalysis | null>(null);

  // Recommendation state
  const [showReco, setShowReco] = useState(false);
  const [recoItems, setRecoItems] = useState<AtsRecommendationItem[] | null>(null);

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

  // ── Build current edited CV ──────────────────────────────────────────────────

  const buildEditedCV = (): CVData => {
    const cv: CVData = JSON.parse(JSON.stringify(cvData));
    if (cv.experiences && cv.experiences.length > 0) {
      cv.experiences[0].missions = [...cv.experiences[0].missions, ...editableMissions];
      if (editableProject) {
        cv.experiences[0].projects = [editableProject, ...cv.experiences[0].projects];
      }
    }
    for (const [cat, skills] of Object.entries(editableSkills)) {
      const key = cat as keyof CVData;
      const existing = (cv[key] as string[]) || [];
      (cv[key] as string[]) = [...existing, ...skills];
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
    try {
      const response = await adaptCV(cvData, jobOffer, customInstructions || undefined);
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
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'adaptation du CV");
    } finally {
      setLoading(false);
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
    setError('');
    setShowReco(false);
    setRecoItems(null);
    setLiveScore(null);
    setJobAnalysis(null);
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
    try {
      const reco = await getAtsRecommendations(cvToAnalyze, jobOffer);
      setRecoItems(reco.recommendations);
      // currentScore reflects the CV state at analysis time
      setLiveScore(reco.currentScore);
      // Also cache jobAnalysis for future real-time scoring (if not yet set from adaptation)
      if (!jobAnalysis && reco.currentScore) {
        // jobAnalysis not available from recommend endpoint directly,
        // but liveScore will be set so real-time diff is visible
      }
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

  // ── Result view ──────────────────────────────────────────────────────────────

  if (result) {
    const scoreBefore = result.atsScore.before;
    const scoreAfter = liveScore ?? result.atsScore.after;

    return (
      <div className="adapt-page">
        <ModuleHeader title="Resultat de l'adaptation" onBack={handleRetry} />

        <div className="adapt-result">
          <AtsScoreBlock before={scoreBefore} after={scoreAfter} />

          <div className="adapt-changes">
            <h3>Modifications apportees — editables</h3>

            {editableMissions.length > 0 && (
              <div className="change-section">
                <h4>Nouvelles missions</h4>
                {editableMissions.map((mission, idx) => (
                  <div key={idx} className="editable-mission-row">
                    <textarea
                      className="editable-textarea"
                      value={mission}
                      onChange={e => updateMission(idx, e.target.value)}
                      rows={2}
                    />
                    <button
                      className="btn-icon-remove"
                      onClick={() => removeMission(idx)}
                      title="Supprimer cette mission"
                    >
                      ×
                    </button>
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
                      rows={2}
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
                <h4>Competences ajoutees</h4>
                <div className="editable-skills-row">
                  {Object.entries(editableSkills).map(([category, skills]) =>
                    skills.map((skill, idx) => (
                      <div key={`${category}-${idx}`} className="editable-skill-tag">
                        <span className="editable-skill-cat">{category}</span>
                        <span className="editable-skill-name">{skill}</span>
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
            />
          )}

          {error && <div className="adapt-error">{error}</div>}

          <div className="adapt-actions">
            <button className="btn btn-secondary" onClick={handleRetry}>
              Modifier les parametres
            </button>
            <button
              className="btn btn-primary"
              onClick={handleValidate}
              disabled={loadingValidate}
            >
              {loadingValidate ? 'Sauvegarde...' : '✓ Sauvegarder l\'adaptation'}
            </button>
            <button
              className="btn btn-outline"
              onClick={handleDownloadPDF}
              disabled={loadingPDF}
            >
              {loadingPDF ? (
                <>
                  <LoadingSpinner size="small" />
                  <span>PDF...</span>
                </>
              ) : (
                '↓ Télécharger PDF'
              )}
            </button>
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
            <button className="btn btn-outline" onClick={onCancel}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form view ────────────────────────────────────────────────────────────────

  return (
    <div className="adapt-page">
      <ModuleHeader title="Adapter le CV" onBack={onCancel} />

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
            et adaptera votre CV en consequence.
          </p>
        </div>

        <div className="form-section">
          <label htmlFor="instructions">Instructions personnalisees (optionnel)</label>
          <textarea
            id="instructions"
            value={customInstructions}
            onChange={e => setCustomInstructions(e.target.value)}
            placeholder="Ex: Mettre l'accent sur l'experience en management..."
            rows={4}
            disabled={loading}
          />
          <p className="form-hint">
            Ajoutez des instructions specifiques pour guider l'adaptation.
          </p>
        </div>

        {error && <div className="adapt-error">{error}</div>}

        <div className="adapt-actions">
          <button
            className="btn btn-primary"
            onClick={handleAdapt}
            disabled={loading || !jobOffer.trim()}
          >
            {loading ? (
              <>
                <LoadingSpinner size="small" />
                <span>Adaptation en cours...</span>
              </>
            ) : (
              'Adapter le CV'
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
              '💡 Recommandations IA'
            )}
          </button>
          <button className="btn btn-outline" onClick={onCancel} disabled={loading}>
            Annuler
          </button>
        </div>

        {showReco && (
          <RecommendationsPanel items={recoItems} loading={loadingReco} />
        )}

        <div className="adapt-info">
          <h4>Comment fonctionne l'adaptation ?</h4>
          <ul>
            <li>L'IA analyse l'offre pour extraire les mots-clés ATS <em>exacts</em> (token-exact)</li>
            <li>1-2 nouvelles missions sont ajoutees avec les tokens verbatim de l'offre</li>
            <li>Un nouveau projet pertinent peut etre genere</li>
            <li>Des competences ciblees sont ajoutees (max 1 par categorie)</li>
            <li>Score ATS avant/apres calcule (modele Jobscan)</li>
            <li>Missions, projet et competences sont editables avant validation</li>
            <li>
              "Analyser les gaps" → identifie les mots manquants → "Générer et appliquer" les
              ajoute directement aux champs
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
