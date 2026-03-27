import { useState } from 'react';
import { ModuleHeader, LoadingSpinner } from '@boilerplate/shared/components';
import type { CVData, AdaptResponse, Project } from '../../types';
import { adaptCV } from '../../services/api';
import './AdaptCVPage.css';

interface AdaptCVPageProps {
  cvData: CVData;
  onAdapt: (adaptedCV: CVData) => void;
  onCancel: () => void;
}

export function AdaptCVPage({ cvData, onAdapt, onCancel }: AdaptCVPageProps) {
  const [jobOffer, setJobOffer] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AdaptResponse | null>(null);

  const handleAdapt = async () => {
    if (!jobOffer.trim()) {
      setError('Veuillez saisir le texte de l\'offre d\'emploi');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await adaptCV(cvData, jobOffer, customInstructions || undefined);
      setResult(response);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'adaptation du CV');
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = () => {
    if (result) {
      onAdapt(result.adaptedCV);
    }
  };

  const handleRetry = () => {
    setResult(null);
    setError('');
  };

  // If we have a result, show the preview
  if (result) {
    return (
      <div className="adapt-page">
        <ModuleHeader title="Resultat de l'adaptation" onBack={handleRetry} />

        <div className="adapt-result">
          <div className="adapt-changes">
            <h3>Modifications apportees</h3>

            {result.changes.newMissions.length > 0 && (
              <div className="change-section">
                <h4>Nouvelles missions ajoutees</h4>
                <ul className="added-list">
                  {result.changes.newMissions.map((mission, idx) => (
                    <li key={idx} className="added-item">{mission}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.changes.newProject && (
              <div className="change-section">
                <h4>Nouveau projet ajoute</h4>
                <div className="added-project">
                  <strong>{result.changes.newProject.title}</strong>
                  {result.changes.newProject.description && (
                    <p>{result.changes.newProject.description}</p>
                  )}
                </div>
              </div>
            )}

            {Object.keys(result.changes.addedSkills).length > 0 && (
              <div className="change-section">
                <h4>Competences ajoutees</h4>
                <div className="added-skills">
                  {Object.entries(result.changes.addedSkills).map(([category, skills]) => (
                    <div key={category} className="skill-category">
                      <span className="category-name">{category}:</span>
                      {skills.map((skill, idx) => (
                        <span key={idx} className="added-skill">{skill}</span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.changes.newMissions.length === 0 &&
             !result.changes.newProject &&
             Object.keys(result.changes.addedSkills).length === 0 && (
              <p className="no-changes">Aucune modification significative apportee.</p>
            )}
          </div>

          <div className="adapt-actions">
            <button className="btn btn-secondary" onClick={handleRetry}>
              Modifier les parametres
            </button>
            <button className="btn btn-primary" onClick={handleValidate}>
              Valider et appliquer
            </button>
            <button className="btn btn-outline" onClick={onCancel}>
              Annuler
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="adapt-page">
      <ModuleHeader title="Adapter le CV" onBack={onCancel} />

      <div className="adapt-form">
        <div className="form-section">
          <label htmlFor="jobOffer">Offre d'emploi *</label>
          <textarea
            id="jobOffer"
            value={jobOffer}
            onChange={(e) => setJobOffer(e.target.value)}
            placeholder="Collez ici le texte complet de l'offre d'emploi..."
            rows={12}
            disabled={loading}
          />
          <p className="form-hint">
            Copiez-collez le texte de l'offre d'emploi. L'IA analysera les competences requises
            et adaptera votre CV en consequence.
          </p>
        </div>

        <div className="form-section">
          <label htmlFor="instructions">Instructions personnalisees (optionnel)</label>
          <textarea
            id="instructions"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
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
          <button className="btn btn-outline" onClick={onCancel} disabled={loading}>
            Annuler
          </button>
        </div>

        <div className="adapt-info">
          <h4>Comment fonctionne l'adaptation ?</h4>
          <ul>
            <li>L'IA analyse l'offre d'emploi pour identifier les competences cles</li>
            <li>1-2 nouvelles missions sont ajoutees a votre premiere experience</li>
            <li>Un nouveau projet pertinent peut etre genere</li>
            <li>Des competences ciblees sont ajoutees (max 1 par categorie)</li>
            <li>Vos donnees originales sont preservees</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
