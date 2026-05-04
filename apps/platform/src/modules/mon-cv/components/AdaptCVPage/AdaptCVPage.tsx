import { useState } from 'react';
import { ModuleHeader, Button } from '@boilerplate/shared/components';
import type { CVData } from '../../types';
import { AdaptCVTilesModal } from '../AdaptCVTilesModal';
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

  const cvLabel = cvData.name?.trim() || cvData.title?.trim() || `CV #${cvId}`;
  const canValidate = jobOffer.trim().length >= 50; // garde-fou : on évite de lancer sur 3 mots

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
          onClose={() => setShowModal(false)}
          onDone={(adaptationId) => {
            setShowModal(false);
            onSaved(adaptationId);
          }}
        />
      )}
    </>
  );
}
