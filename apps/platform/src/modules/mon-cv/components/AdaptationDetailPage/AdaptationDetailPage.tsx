import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { ModuleHeader, LoadingSpinner } from '@boilerplate/shared/components';
import type { CVAdaptation, CVData, Project, AtsScore, AtsRecommendationItem } from '../../types';
import { getAdaptation, updateAdaptation, downloadAdaptationPDF, getFullPreviewHTML, getAtsRecommendations } from '../../services/api';
import './AdaptationDetailPage.css';

interface AdaptationDetailPageProps {
  adaptationId: number;
  onBack: () => void;
}

// ─── Client-side ATS scoring (same as AdaptCVPage) ───────────────────────────

function normalizeText(text: string): string { return text.toLowerCase().trim(); }
function containsKeyword(text: string, keyword: string): boolean {
  if (!keyword || !text) return false;
  return normalizeText(text).includes(normalizeText(keyword));
}
function extractExpText(cv: CVData): string {
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
function extractSkillText(cv: CVData): string {
  return [...(cv.competences || []), ...(cv.outils || []), ...(cv.dev || []),
    ...(cv.frameworks || []), ...(cv.solutions || [])].join(' ');
}
function computeScore(cv: CVData, jobAnalysis: CVAdaptation['jobAnalysis']): AtsScore {
  const { requiredKeywords, exactJobTitle } = jobAnalysis;
  const expText = extractExpText(cv);
  const skillText = extractSkillText(cv);
  const cvNorm = normalizeText(cv.title || '');
  const jobNorm = normalizeText(exactJobTitle || '');
  const requiredFound: string[] = [], requiredMissing: string[] = [];
  const multiSectionKeywords: string[] = [], singleSectionKeywords: string[] = [];
  for (const kw of requiredKeywords) {
    const inExp = containsKeyword(expText, kw);
    const inSkill = containsKeyword(skillText, kw);
    if (inExp || inSkill) {
      requiredFound.push(kw);
      if (inExp && inSkill) multiSectionKeywords.push(kw);
      else singleSectionKeywords.push(kw);
    } else {
      requiredMissing.push(kw);
    }
  }
  const total = requiredKeywords.length;
  const keywordMatch = total > 0 ? Math.round((requiredFound.length / total) * 100) : 100;
  const sectionCoverage = total > 0 ? Math.round((multiSectionKeywords.length / total) * 100) : 100;
  const titleMatch = jobNorm.length > 0 && (cvNorm === jobNorm || cvNorm.includes(jobNorm) || jobNorm.includes(cvNorm));
  const overall = Math.round(0.5 * keywordMatch + 0.3 * sectionCoverage + 0.2 * (titleMatch ? 100 : 0));
  return { overall, keywordMatch, sectionCoverage, titleMatch, breakdown: { requiredFound, requiredMissing, multiSectionKeywords, singleSectionKeywords } };
}

function getScoreClass(s: number) { return s >= 75 ? 'detail-score-good' : s >= 50 ? 'detail-score-medium' : 'detail-score-bad'; }

export function AdaptationDetailPage({ adaptationId, onBack }: AdaptationDetailPageProps) {
  const [adaptation, setAdaptation] = useState<CVAdaptation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloadingPDF, setDownloadingPDF] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Editable state
  const [name, setName] = useState('');
  const [editableMissions, setEditableMissions] = useState<string[]>([]);
  const [editableProject, setEditableProject] = useState<Project | undefined>(undefined);
  const [editableSkills, setEditableSkills] = useState<Record<string, string[]>>({});
  const [liveScore, setLiveScore] = useState<AtsScore | null>(null);

  // AI Recommendations state
  const [showReco, setShowReco] = useState(false);
  const [loadingReco, setLoadingReco] = useState(false);
  const [recoItems, setRecoItems] = useState<AtsRecommendationItem[] | null>(null);
  const [recoError, setRecoError] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // Auto-resize textarea helper
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, []);

  const handleTextareaInput = useCallback((e: FormEvent<HTMLTextAreaElement>) => {
    autoResize(e.currentTarget);
  }, [autoResize]);

  // Auto-resize all textareas when editable content changes
  useEffect(() => {
    if (!pageRef.current) return;
    const textareas = pageRef.current.querySelectorAll('textarea');
    textareas.forEach((ta) => autoResize(ta));
  }, [editableMissions, editableProject, autoResize]);

  useEffect(() => {
    loadAdaptation();
  }, [adaptationId]);

  // Real-time score on edits
  useEffect(() => {
    if (!adaptation) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const currentCV = buildEditedCV();
      setLiveScore(computeScore(currentCV, adaptation.jobAnalysis));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editableMissions, editableProject, editableSkills, adaptation]);

  const loadAdaptation = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAdaptation(adaptationId);
      setAdaptation(data);
      setName(data.name || '');
      setEditableMissions([...(data.changes.newMissions || [])]);
      setEditableProject(data.changes.newProject ? { ...data.changes.newProject } : undefined);
      const skillsCopy: Record<string, string[]> = {};
      for (const [cat, skills] of Object.entries(data.changes.addedSkills || {})) {
        skillsCopy[cat] = [...skills];
      }
      setEditableSkills(skillsCopy);
      setLiveScore(data.atsAfter);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  const buildEditedCV = (): CVData => {
    if (!adaptation) return {} as CVData;
    // Start from adaptedCv (which includes the generated content)
    const cv: CVData = JSON.parse(JSON.stringify(adaptation.adaptedCv));

    if (cv.experiences && cv.experiences.length > 0) {
      // Remove ALL originally generated missions (by their ORIGINAL text before any edits)
      const originalNewMissions = adaptation.changes.newMissions || [];
      const baseMissions = cv.experiences[0].missions.filter(
        m => !originalNewMissions.includes(m)
      );
      // Add current editable missions (user may have edited them)
      cv.experiences[0].missions = [...baseMissions, ...editableMissions.filter(m => m.trim())];

      // Remove generated project by ORIGINAL title (not current edited title)
      if (adaptation.changes.newProject) {
        cv.experiences[0].projects = cv.experiences[0].projects.filter(
          p => p.title !== adaptation.changes.newProject!.title
        );
      }
      // Add current editable project
      if (editableProject && editableProject.title.trim()) {
        cv.experiences[0].projects = [editableProject, ...cv.experiences[0].projects];
      }
    }

    // Skills: remove ORIGINAL generated skills, add current editable
    const originalAddedSkills = adaptation.changes.addedSkills || {};
    for (const [cat, origSkills] of Object.entries(originalAddedSkills)) {
      const key = cat as keyof CVData;
      const current = (cv[key] as string[]) || [];
      const withoutGenerated = current.filter(s => !origSkills.includes(s));
      const editedSkills = editableSkills[cat] || [];
      (cv[key] as string[]) = [...withoutGenerated, ...editedSkills];
    }
    // Add any new skill categories from editable not in original
    for (const [cat, skills] of Object.entries(editableSkills)) {
      if (!(cat in originalAddedSkills) && skills.length > 0) {
        const key = cat as keyof CVData;
        const current = (cv[key] as string[]) || [];
        (cv[key] as string[]) = [...current, ...skills];
      }
    }
    return cv;
  };

  const handleSave = async () => {
    if (!adaptation) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const adaptedCv = buildEditedCV();
      const updated = await updateAdaptation(adaptationId, { adaptedCv, name: name || undefined });
      setAdaptation(updated);
      setLiveScore(updated.atsAfter);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPDF = async () => {
    setDownloadingPDF(true);
    try {
      const filename = `${name || 'CV_adapte'}.pdf`;
      await downloadAdaptationPDF(adaptationId, filename);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du téléchargement PDF');
    } finally {
      setDownloadingPDF(false);
    }
  };

  const handlePreviewHTML = async () => {
    setLoadingPreview(true);
    setError('');
    try {
      const cv = buildEditedCV();
      const html = await getFullPreviewHTML(cv);
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la génération de l\'aperçu');
    } finally {
      setLoadingPreview(false);
    }
  };

  const updateMission = (idx: number, value: string) => {
    setEditableMissions(prev => prev.map((m, i) => i === idx ? value : m));
  };
  const removeMission = (idx: number) => {
    setEditableMissions(prev => prev.filter((_, i) => i !== idx));
  };
  const removeSkill = (cat: string, skill: string) => {
    setEditableSkills(prev => ({
      ...prev,
      [cat]: (prev[cat] || []).filter(s => s !== skill),
    }));
  };

  const handleGetRecommendations = async () => {
    if (!adaptation) return;
    setLoadingReco(true);
    setRecoError('');
    setShowReco(true);
    setRecoItems(null);
    try {
      const currentCV = buildEditedCV();
      const reco = await getAtsRecommendations(currentCV, adaptation.jobOffer);
      setRecoItems(reco.recommendations);
      setLiveScore(reco.currentScore);
    } catch (err: any) {
      setRecoError(err.message || 'Erreur lors de l\'analyse');
    } finally {
      setLoadingReco(false);
    }
  };

  if (loading) return (
    <div className="adapt-detail-page">
      <ModuleHeader title="Adaptation" onBack={onBack} />
      <div className="adapt-detail-loading"><LoadingSpinner /></div>
    </div>
  );

  if (!adaptation) return (
    <div className="adapt-detail-page">
      <ModuleHeader title="Adaptation" onBack={onBack} />
      <div className="adapt-detail-error">Adaptation introuvable</div>
    </div>
  );

  const displayScore = liveScore ?? adaptation.atsAfter;
  const delta = displayScore.overall - adaptation.atsBefore.overall;
  const hasEdits = editableMissions.join('') !== (adaptation.changes.newMissions || []).join('') ||
    JSON.stringify(editableSkills) !== JSON.stringify(adaptation.changes.addedSkills || {}) ||
    name !== (adaptation.name || '') ||
    editableProject?.title !== adaptation.changes.newProject?.title;

  return (
    <div className="adapt-detail-page" ref={pageRef}>
      <ModuleHeader
        title="Détail de l'adaptation"
        onBack={onBack}
      >
        <button
          className="module-header-btn"
          onClick={handlePreviewHTML}
          disabled={loadingPreview || downloadingPDF}
        >
          {loadingPreview ? '...' : '👁 Aperçu'}
        </button>
        <button
          className="module-header-btn"
          onClick={handleDownloadPDF}
          disabled={downloadingPDF || loadingPreview}
        >
          {downloadingPDF ? '...' : '↓ PDF'}
        </button>
        <button
          className="module-header-btn"
          onClick={handleGetRecommendations}
          disabled={loadingReco || downloadingPDF}
        >
          {loadingReco ? '...' : '✦ Optimiser le score ATS'}
        </button>
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={handleSave}
          disabled={saving || !hasEdits}
        >
          {saving ? 'Sauvegarde...' : saved ? '✓ Sauvegardé' : 'Sauvegarder'}
        </button>
      </ModuleHeader>

      {error && <div className="adapt-detail-error-banner">{error}</div>}

      {/* AI Recommendations */}
      {showReco && (
        <div className="adapt-detail-reco-panel">
          <div className="adapt-detail-reco-header">
            <span>Optimisation ATS</span>
            <button
              className="adapt-detail-btn-remove-inline"
              onClick={() => setShowReco(false)}
            >
              Fermer
            </button>
          </div>
          {recoError && <div className="adapt-detail-reco-error">{recoError}</div>}
          {loadingReco && (
            <div className="adapt-detail-reco-loading">
              <LoadingSpinner size="small" />
              <span>Analyse en cours...</span>
            </div>
          )}
          {!loadingReco && recoItems && recoItems.length === 0 && (
            <p className="adapt-detail-reco-empty">Aucune recommandation — score optimal !</p>
          )}
          {!loadingReco && recoItems && recoItems.length > 0 && (
            <div className="adapt-detail-reco-list">
              {recoItems.map((item, idx) => (
                <div key={idx} className={`adapt-detail-reco-item adapt-detail-reco-priority-${item.priority}`}>
                  <div className="adapt-detail-reco-item-title">
                    <span className="adapt-detail-reco-badge">{item.priority.toUpperCase()}</span>
                    <span className={`adapt-detail-reco-type adapt-detail-reco-type-${item.type}`}>
                      {item.type === 'add' ? 'AJOUT' : item.type === 'replace' ? 'REMPLACEMENT' : 'RÉPÉTITION'}
                    </span>
                    <span className="adapt-detail-reco-action">{item.action}</span>
                  </div>
                  {item.example && <div className="adapt-detail-reco-example">{item.example}</div>}
                  {item.keywords.length > 0 && (
                    <div className="adapt-detail-reco-keywords">
                      {item.keywords.map(k => (
                        <span key={k} className="adapt-detail-reco-keyword">"{k}"</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Name */}
      <div className="adapt-detail-section">
        <label className="adapt-detail-label">Nom de l'adaptation</label>
        <input
          className="adapt-detail-name-input"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Ex: Adaptation LinkedIn mars 2026"
        />
      </div>

      {/* ATS Score */}
      <div className="adapt-detail-section adapt-detail-score-block">
        <div className="adapt-detail-score-header">Score ATS</div>
        <div className="adapt-detail-score-row">
          <div className="adapt-detail-score-side">
            <div className="adapt-detail-score-label">Avant</div>
            <div className={`adapt-detail-score-value ${getScoreClass(adaptation.atsBefore.overall)}`}>
              {adaptation.atsBefore.overall}%
            </div>
          </div>
          <div className="adapt-detail-score-arrow">→</div>
          <div className="adapt-detail-score-side">
            <div className="adapt-detail-score-label">Actuel</div>
            <div className={`adapt-detail-score-value ${getScoreClass(displayScore.overall)}`}>
              {displayScore.overall}%
            </div>
          </div>
          <div className={`adapt-detail-score-delta ${delta >= 0 ? 'positive' : 'negative'}`}>
            {delta >= 0 ? '+' : ''}{delta}
          </div>
        </div>
        {displayScore.breakdown.requiredMissing.length > 0 && (
          <div className="adapt-detail-missing">
            Manquants : {displayScore.breakdown.requiredMissing.map(k => `"${k}"`).join(', ')}
          </div>
        )}
      </div>

      {/* Job offer */}
      <div className="adapt-detail-section">
        <div className="adapt-detail-label">Offre d'emploi utilisée</div>
        <div className="adapt-detail-offer-text">{adaptation.jobOffer}</div>
      </div>

      {/* Editable missions */}
      {editableMissions.length > 0 && (
        <div className="adapt-detail-section">
          <div className="adapt-detail-label">Missions générées</div>
          {editableMissions.map((mission, idx) => (
            <div key={idx} className="adapt-detail-mission-row">
              <div className="adapt-detail-mission-header">
                <span className="adapt-detail-mission-num">Mission {idx + 1}</span>
                <button
                  className="adapt-detail-btn-remove adapt-detail-btn-remove-inline"
                  onClick={() => removeMission(idx)}
                  title="Supprimer cette mission"
                >
                  × Supprimer
                </button>
              </div>
              <textarea
                className="adapt-detail-textarea adapt-detail-textarea-auto"
                value={mission}
                onChange={e => updateMission(idx, e.target.value)}
                onInput={handleTextareaInput}
              />
            </div>
          ))}
        </div>
      )}

      {/* Editable project */}
      {editableProject && (
        <div className="adapt-detail-section">
          <div className="adapt-detail-label">
            Projet généré
            <button
              className="adapt-detail-btn-remove adapt-detail-btn-remove-inline"
              onClick={() => setEditableProject(undefined)}
            >
              × Supprimer le projet
            </button>
          </div>
          <input
            className="adapt-detail-input"
            value={editableProject.title}
            onChange={e => setEditableProject(prev => prev ? { ...prev, title: e.target.value } : prev)}
            placeholder="Titre du projet"
          />
          <textarea
            className="adapt-detail-textarea adapt-detail-textarea-auto"
            value={editableProject.description || ''}
            onChange={e => setEditableProject(prev => prev ? { ...prev, description: e.target.value } : prev)}
            onInput={handleTextareaInput}
            placeholder="Description du projet"
          />
        </div>
      )}

      {/* Editable skills */}
      {Object.entries(editableSkills).some(([, skills]) => skills.length > 0) && (
        <div className="adapt-detail-section">
          <div className="adapt-detail-label">Compétences ajoutées</div>
          {Object.entries(editableSkills).map(([cat, skills]) =>
            skills.length > 0 ? (
              <div key={cat} className="adapt-detail-skills-group">
                <div className="adapt-detail-skills-cat">{cat}</div>
                <div className="adapt-detail-skills-tags">
                  {skills.map(skill => (
                    <span key={skill} className="adapt-detail-skill-tag">
                      {skill}
                      <button onClick={() => removeSkill(cat, skill)} title="Supprimer">×</button>
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
