import { useState, useEffect, useCallback } from 'react';
import { Modal, Button } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { DocumentWithSections, Document, Subject } from '../../types';
import './LinkSubjectModal.css';

interface Props {
  subject: Subject;
  /** The document the subject is currently being viewed in. We pre-
   *  filter it from the picker because linking to your CURRENT doc's
   *  sections is allowed but rarely what the user wants ; the
   *  canonical home section is also rejected server-side. */
  currentDocumentId: string;
  onClose: () => void;
  /** Fired after a link is created or removed so the parent can
   *  refresh its rendered SuiviTess state. */
  onChange?: () => void;
}

/** Lets the user surface a subject inside one or more other SuiviTess
 *  documents. The subject lives in ONE canonical section ; this modal
 *  manages the cross-document pointers (suivitess_subject_cross_links).
 *  Editing the subject anywhere updates the canonical row, so every
 *  linked occurrence sees the change automatically. */
export function LinkSubjectModal({ subject, currentDocumentId, onClose, onChange }: Props) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [pickedDocId, setPickedDocId] = useState<string>('');
  const [pickedDocSections, setPickedDocSections] = useState<DocumentWithSections | null>(null);
  const [pickedSectionId, setPickedSectionId] = useState<string>('');
  const [existingLinks, setExistingLinks] = useState<api.SubjectCrossLinkLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLinks = useCallback(async () => {
    try {
      const list = await api.listSubjectCrossLinks(subject.id);
      setExistingLinks(list);
    } catch (err) {
      setError(`Lecture des liens existants impossible : ${(err as Error).message}`);
    }
  }, [subject.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [allDocs] = await Promise.all([
          api.fetchDocuments(),
          refreshLinks(),
        ]);
        if (cancelled) return;
        setDocs(allDocs);
      } catch (err) {
        if (!cancelled) setError(`Lecture des suivis impossible : ${(err as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshLinks]);

  // Whenever the user picks a destination doc, fetch its sections so
  // the section dropdown shows real targets instead of a static list.
  useEffect(() => {
    if (!pickedDocId) {
      setPickedDocSections(null);
      setPickedSectionId('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const doc = await api.fetchDocument(pickedDocId);
        if (cancelled) return;
        setPickedDocSections(doc);
        setPickedSectionId(doc.sections[0]?.id ?? '');
      } catch (err) {
        if (!cancelled) setError(`Lecture du suivi impossible : ${(err as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [pickedDocId]);

  const handleAddLink = async () => {
    if (!pickedSectionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createSubjectCrossLink(subject.id, pickedSectionId);
      // Reset picker + refresh the list so the new link shows up.
      setPickedSectionId('');
      await refreshLinks();
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveLink = async (linkId: string) => {
    setSubmitting(true);
    setError(null);
    try {
      await api.deleteSubjectCrossLink(linkId);
      await refreshLinks();
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const otherDocs = docs.filter(d => d.id !== currentDocumentId);
  // When picking the current doc, hide the canonical home section so
  // the user can't try to link a subject to its own section.
  const sectionOptions = (pickedDocSections?.sections ?? []).filter(s => s.id !== subject.section_id);

  return (
    <Modal isOpen={true} onClose={onClose} title="Lier ce sujet à d'autres suivis">
      <div className="link-subject-modal">
        <p className="link-subject-modal__intro">
          <strong>« {subject.title} »</strong> est suivi à un seul endroit aujourd'hui.
          Lier le sujet à d'autres suivis le fait apparaître dans chacun, comme une carte avec un badge « lié ». Toute modification se propage automatiquement à tous les emplacements.
        </p>

        {error && <div className="link-subject-modal__error">⚠ {error}</div>}

        {/* ── Existing locations ── */}
        <section>
          <h4>Emplacements actuels</h4>
          {loading ? (
            <p className="link-subject-modal__muted">Chargement…</p>
          ) : (
            <ul className="link-subject-modal__locations">
              {existingLinks.map(loc => (
                <li key={loc.linkId ?? `canonical-${loc.sectionId}`}>
                  <span className="link-subject-modal__location-label">
                    <strong>{loc.documentTitle}</strong>
                    <span className="link-subject-modal__sep"> › </span>
                    {loc.sectionName}
                  </span>
                  {loc.isCanonical ? (
                    <span className="link-subject-modal__badge">Origine</span>
                  ) : (
                    <button
                      type="button"
                      className="link-subject-modal__remove-btn"
                      onClick={() => loc.linkId && handleRemoveLink(loc.linkId)}
                      disabled={submitting}
                    >
                      Retirer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Add a new link ── */}
        <section>
          <h4>Ajouter un lien</h4>
          <div className="link-subject-modal__form">
            <label>
              Suivi cible
              <select
                value={pickedDocId}
                onChange={e => setPickedDocId(e.target.value)}
                disabled={submitting || otherDocs.length === 0}
              >
                <option value="">— Choisir un suivi —</option>
                {otherDocs.map(d => (
                  <option key={d.id} value={d.id}>{d.title}</option>
                ))}
              </select>
            </label>
            <label>
              Section
              <select
                value={pickedSectionId}
                onChange={e => setPickedSectionId(e.target.value)}
                disabled={submitting || !pickedDocSections}
              >
                <option value="">— Choisir une section —</option>
                {sectionOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          </div>
          {otherDocs.length === 0 && (
            <p className="link-subject-modal__muted">
              Aucun autre suivi disponible.
            </p>
          )}
        </section>

        {/* Footer : primary action ("Lier ici") on the left, "Fermer"
            on the right. Lier reads from the picker state above and
            stays disabled until both fields are filled. */}
        <div className="link-subject-modal__actions">
          <Button
            variant="primary"
            onClick={handleAddLink}
            disabled={!pickedSectionId || submitting}
          >
            {submitting ? 'Ajout…' : 'Lier ici'}
          </Button>
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </Modal>
  );
}
