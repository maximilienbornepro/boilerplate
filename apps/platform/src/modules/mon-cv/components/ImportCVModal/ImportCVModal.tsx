import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
import { Modal } from '@boilerplate/shared/components';
import type { CV, CVData, DiffItem, ImportPreviewResult } from '../../types';
import * as api from '../../services/api';
import './ImportCVModal.css';

interface ImportCVModalProps {
  onClose: () => void;
  onImport: (cv: CV) => void;
}

type Step = 'upload' | 'preview' | 'merging';

const SECTION_LABELS: Record<string, string> = {
  name: 'Nom',
  title: 'Titre',
  summary: 'Resume',
  contact: 'Contact',
  languages: 'Langues',
  competences: 'Competences',
  outils: 'Outils',
  dev: 'Developpement',
  frameworks: 'Frameworks',
  solutions: 'Solutions',
  experiences: 'Experiences',
  formations: 'Formations',
  awards: 'Distinctions',
  sideProjects: 'Projets personnels',
};

export function ImportCVModal({ onClose, onImport }: ImportCVModalProps) {
  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const processFile = async (file: File) => {
    setError(null);

    // Validate file type
    const validTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    if (!validTypes.includes(file.type)) {
      setError('Format non supporte. Utilisez PDF ou DOCX.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError('Le fichier ne doit pas depasser 10 Mo');
      return;
    }

    try {
      setIsProcessing(true);
      const result = await api.previewImport(file);
      setPreview(result);

      // Pre-select sections with changes
      const sectionsWithChanges = result.diff
        .filter((d) => d.hasChanges)
        .map((d) => d.section);
      setSelectedSections(sectionsWithChanges);

      setStep('preview');
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'analyse du fichier');
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleSection = (section: string) => {
    setSelectedSections((prev) =>
      prev.includes(section)
        ? prev.filter((s) => s !== section)
        : [...prev, section]
    );
  };

  const selectAll = () => {
    if (!preview) return;
    const allSections = preview.diff.filter((d) => d.hasChanges).map((d) => d.section);
    setSelectedSections(allSections);
  };

  const selectNone = () => {
    setSelectedSections([]);
  };

  const handleMerge = async () => {
    if (!preview || selectedSections.length === 0) return;

    try {
      setStep('merging');
      const cv = await api.mergeImport(selectedSections, preview.parsed);
      onImport(cv);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la fusion');
      setStep('preview');
    }
  };

  const handleDirectImport = async () => {
    if (!preview) return;

    try {
      setStep('merging');
      // Select all sections for direct import
      const allSections = Object.keys(SECTION_LABELS);
      const cv = await api.mergeImport(allSections, preview.parsed);
      onImport(cv);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de l\'import');
      setStep('preview');
    }
  };

  return (
    <Modal onClose={onClose} title="Importer un CV">
      <div className="import-cv-modal">
        {step === 'upload' && (
          <div className="import-cv-upload">
            <div
              className={`import-cv-dropzone ${isDragging ? 'dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              {isProcessing ? (
                <div className="import-cv-processing">
                  <div className="import-cv-spinner" />
                  <span>Analyse en cours...</span>
                </div>
              ) : (
                <>
                  <span className="import-cv-icon">&#x1F4C4;</span>
                  <span className="import-cv-text">
                    Glisser-deposer ou cliquer pour selectionner
                  </span>
                  <span className="import-cv-formats">
                    Formats acceptes : PDF, DOCX
                  </span>
                </>
              )}
            </div>

            {error && <div className="import-cv-error">{error}</div>}

            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleChange}
              style={{ display: 'none' }}
            />
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="import-cv-preview">
            <div className="import-cv-preview-header">
              <span>Selectionnez les sections a importer :</span>
              <div className="import-cv-preview-actions">
                <button type="button" onClick={selectAll}>Tout</button>
                <button type="button" onClick={selectNone}>Rien</button>
              </div>
            </div>

            <div className="import-cv-sections">
              {preview.diff.map((item) => (
                <label
                  key={item.section}
                  className={`import-cv-section ${!item.hasChanges ? 'disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedSections.includes(item.section)}
                    onChange={() => toggleSection(item.section)}
                    disabled={!item.hasChanges}
                  />
                  <span className="import-cv-section-name">
                    {SECTION_LABELS[item.section] || item.section}
                  </span>
                  {item.isNew && (
                    <span className="import-cv-badge new">Nouveau</span>
                  )}
                  {item.hasChanges && !item.isNew && (
                    <span className="import-cv-badge changed">Modifie</span>
                  )}
                  {!item.hasChanges && (
                    <span className="import-cv-badge empty">Vide</span>
                  )}
                </label>
              ))}
            </div>

            {error && <div className="import-cv-error">{error}</div>}

            <div className="import-cv-footer">
              <button
                type="button"
                className="import-cv-btn secondary"
                onClick={() => setStep('upload')}
              >
                Retour
              </button>
              <button
                type="button"
                className="import-cv-btn secondary"
                onClick={handleDirectImport}
              >
                Remplacer tout
              </button>
              <button
                type="button"
                className="import-cv-btn primary"
                onClick={handleMerge}
                disabled={selectedSections.length === 0}
              >
                Fusionner ({selectedSections.length})
              </button>
            </div>
          </div>
        )}

        {step === 'merging' && (
          <div className="import-cv-merging">
            <div className="import-cv-spinner" />
            <span>Fusion en cours...</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
