import { useState, useEffect, useCallback } from 'react';
import { ModuleHeader, Button } from '@boilerplate/shared/components';
import type { CVData, CVAdaptationListItem } from '../../types';
import { AdaptCVTilesModal } from '../AdaptCVTilesModal';
import { fetchAdaptationsForCV, deleteTileAdaptation } from '../../services/api';
import './AdaptCVPage.css';

interface Props {
  cvId: number;
  cvData: CVData;
  /** Called once the user has finished walking through the tiles.
   *  Parent navigates to the existing AdaptationDetailPage which
   *  already exposes PDF download + "Modifier dans l'éditeur". */
  onSaved: (adaptationId: number) => void;
  onCancel: () => void;
}

/** Refondue : page minimaliste qui prend une offre en copier-coller
 *  et lance la modale tuile-par-tuile. Toute la logique d'analyse,
 *  ATS scoring client-side et ActionItems précédente a été retirée
 *  au profit du flow à 2 skills (extract + adapt). */
export function AdaptCVPage({ cvId, cvData, onSaved, onCancel }: Props) {
  const [jobOffer, setJobOffer] = useState('');
  const [showModal, setShowModal] = useState(false);
  // When set, the modal opens in resume-mode against this draft.
  const [resumingId, setResumingId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<CVAdaptationListItem[]>([]);

  const cvLabel = cvData.name?.trim() || cvData.title?.trim() || `CV #${cvId}`;
  const canValidate = jobOffer.trim().length >= 50; // garde-fou : on évite de lancer sur 3 mots

  const reloadDrafts = useCallback(async () => {
    try {
      const list = await fetchAdaptationsForCV(cvId);
      setDrafts(list.filter(a => a.status === 'draft'));
    } catch { /* silent — no drafts list is acceptable */ }
  }, [cvId]);

  // Load drafts on mount + whenever the modal closes (so a new
  // draft from this session shows up immediately).
  useEffect(() => {
    reloadDrafts();
  }, [reloadDrafts]);

  const handleResume = (id: number) => {
    setResumingId(id);
    setShowModal(true);
  };

  const handleDeleteDraft = async (id: number) => {
    if (!confirm('Supprimer ce brouillon d\'adaptation ?')) return;
    try {
      await deleteTileAdaptation(id);
      setDrafts(prev => prev.filter(d => d.id !== id));
    } catch { /* silent — refresh will catch up */ }
  };

  return (
    <>
      <ModuleHeader
        title="Adapter le CV à une offre"
        subtitle={cvLabel}
        onBack={onCancel}
      />

      <main className="adapt-cv-page">
        <section className="adapt-cv-page__intro">
          <p>
            Colle ci-dessous l'offre d'emploi que tu vises. L'IA va d'abord
            extraire chaque sujet atomique de ton CV (présentation,
            compétences, expériences, missions, projets…), puis te proposer
            une adaptation pour chacun. Tu valideras tuile par tuile,
            avec la possibilité de modifier, régénérer ou revenir à
            l'original.
          </p>
        </section>

        {drafts.length > 0 && (
          <section className="adapt-cv-page__drafts">
            <h3>Brouillons en cours ({drafts.length})</h3>
            <p className="adapt-cv-page__drafts-hint">
              Ces adaptations n'ont pas été terminées. Reprends là où tu en
              étais, ou supprime-les si tu n'en veux plus.
            </p>
            <ul>
              {drafts.map(d => (
                <li key={d.id} className="adapt-cv-page__draft">
                  <div className="adapt-cv-page__draft-info">
                    <strong>{d.name || `Brouillon #${d.id}`}</strong>
                    <span className="adapt-cv-page__draft-preview">
                      {d.jobOfferPreview}
                      {d.jobOfferPreview.length === 120 && '…'}
                    </span>
                    <span className="adapt-cv-page__draft-date">
                      {new Date(d.createdAt).toLocaleString('fr-FR', {
                        day: '2-digit', month: 'short',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="adapt-cv-page__draft-actions">
                    <Button variant="primary" onClick={() => handleResume(d.id)}>
                      Reprendre
                    </Button>
                    <Button variant="secondary" onClick={() => handleDeleteDraft(d.id)}>
                      Supprimer
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="adapt-cv-page__form">
          <label htmlFor="adapt-cv-offer">
            Offre d'emploi
            <span className="adapt-cv-page__hint">
              Colle le contenu intégral (titre + description + missions + profil recherché)
            </span>
          </label>
          <textarea
            id="adapt-cv-offer"
            className="adapt-cv-page__textarea"
            value={jobOffer}
            onChange={e => setJobOffer(e.target.value)}
            placeholder="Ex : Senior Backend Developer (H/F) — France TV…"
            rows={18}
          />
          <div className="adapt-cv-page__form-meta">
            <span className="adapt-cv-page__char-count">
              {jobOffer.trim().length} caractères
              {!canValidate && jobOffer.length > 0 && ' · ajoute encore un peu de contenu (50 mini)'}
            </span>
          </div>
        </section>

        <div className="adapt-cv-page__actions">
          <Button variant="secondary" onClick={onCancel}>Annuler</Button>
          <Button
            variant="primary"
            onClick={() => setShowModal(true)}
            disabled={!canValidate}
          >
            Valider et lancer l'adaptation
          </Button>
        </div>
      </main>

      {showModal && (
        <AdaptCVTilesModal
          cvId={cvId}
          jobOffer={jobOffer.trim()}
          resumeAdaptationId={resumingId ?? undefined}
          onClose={() => {
            // Closing the modal (croix or click outside) does NOT
            // delete the draft — it stays resumable in the list.
            setShowModal(false);
            setResumingId(null);
            reloadDrafts();
          }}
          onDone={(adaptationId) => {
            setShowModal(false);
            setResumingId(null);
            onSaved(adaptationId);
          }}
        />
      )}
    </>
  );
}
