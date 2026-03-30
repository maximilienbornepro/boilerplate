import { useState, useEffect, useCallback, useRef } from 'react';
import { ModuleHeader, ToastContainer, ConfirmModal } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { ExpandableSection } from '../ExpandableSection';
import { TagEditor } from '../TagEditor';
import { ListEditor } from '../ListEditor';
import { ProjectEditor } from '../ProjectEditor';
import { ImageUploader } from '../ImageUploader';
import { ImportCVModal } from '../ImportCVModal';
import { ExportSection } from '../ExportSection';
import type { CV, CVData, Experience, Formation, Award } from '../../types';
import { createEmptyCV } from '../../types';
import * as api from '../../services/api';
import './MyProfilePage.css';

interface MyProfilePageProps {
  onNavigate?: (path: string) => void;
  cvId?: number;  // If provided, load and save this specific CV instead of default
}

export function MyProfilePage({ onNavigate, cvId }: MyProfilePageProps) {
  const [cv, setCv] = useState<CV | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [deleteExperienceConfirm, setDeleteExperienceConfirm] = useState<number | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  // Debounce timer ref
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Load CV
  const loadCV = useCallback(async () => {
    try {
      setLoading(true);
      const data = cvId ? await api.fetchCV(cvId) : await api.fetchDefaultCV();
      setCv(data);
    } catch (err: any) {
      console.error('Failed to load CV:', err);
      addToast({ type: 'error', message: 'Erreur lors du chargement du CV' });
    } finally {
      setLoading(false);
    }
  }, [cvId, addToast]);

  useEffect(() => {
    loadCV();
  }, [loadCV]);

  // Auto-save with debounce
  const saveCV = useCallback(async (cvData: CVData) => {
    try {
      setSaving(true);
      const updated = cvId
        ? await api.updateCV(cvId, { cvData })
        : await api.updateDefaultCV(cvData);
      setCv(updated);
    } catch (err: any) {
      console.error('Failed to save CV:', err);
      addToast({ type: 'error', message: 'Erreur lors de la sauvegarde' });
    } finally {
      setSaving(false);
    }
  }, [cvId, addToast]);

  const handleChange = useCallback((updates: Partial<CVData>) => {
    if (!cv) return;

    const newData = { ...cv.cvData, ...updates };
    setCv({ ...cv, cvData: newData });

    // Clear existing timer
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    // Set new timer for auto-save
    saveTimerRef.current = setTimeout(() => {
      saveCV(newData);
    }, 1000);
  }, [cv, saveCV]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const handleBack = useCallback(() => {
    // If viewing a specific CV (not default), go back to CV list
    if (cvId && onNavigate) onNavigate('/mon-cv');
    else if (onNavigate) onNavigate('/');
    else window.location.href = '/';
  }, [cvId, onNavigate]);

  const handleImportComplete = useCallback((newCV: CV) => {
    setCv(newCV);
    setShowImport(false);
    addToast({ type: 'success', message: 'CV importe avec succes' });
  }, [addToast]);

  const handleUploadImage = useCallback(async (file: File): Promise<string> => {
    const result = await api.uploadImage(file, 'profile');
    return result.image;
  }, []);

  // Experience handlers
  const addExperience = useCallback(() => {
    if (!cv) return;
    const newExp: Experience = {
      title: '',
      company: '',
      period: '',
      location: '',
      description: '',
      missions: [],
      projects: [],
      clients: [],
      technologies: [],
    };
    handleChange({
      experiences: [...(cv.cvData.experiences || []), newExp],
    });
  }, [cv, handleChange]);

  const updateExperience = useCallback((index: number, updates: Partial<Experience>) => {
    if (!cv) return;
    const experiences = [...(cv.cvData.experiences || [])];
    experiences[index] = { ...experiences[index], ...updates };
    handleChange({ experiences });
  }, [cv, handleChange]);

  const removeExperience = useCallback((index: number) => {
    if (!cv) return;
    const experiences = cv.cvData.experiences?.filter((_, i) => i !== index) || [];
    handleChange({ experiences });
    setDeleteExperienceConfirm(null);
  }, [cv, handleChange]);

  // Formation handlers
  const addFormation = useCallback(() => {
    if (!cv) return;
    const newForm: Formation = {
      title: '',
      school: '',
      period: '',
      location: '',
    };
    handleChange({
      formations: [...(cv.cvData.formations || []), newForm],
    });
  }, [cv, handleChange]);

  const updateFormation = useCallback((index: number, updates: Partial<Formation>) => {
    if (!cv) return;
    const formations = [...(cv.cvData.formations || [])];
    formations[index] = { ...formations[index], ...updates };
    handleChange({ formations });
  }, [cv, handleChange]);

  const removeFormation = useCallback((index: number) => {
    if (!cv) return;
    const formations = cv.cvData.formations?.filter((_, i) => i !== index) || [];
    handleChange({ formations });
  }, [cv, handleChange]);

  // Award handlers
  const addAward = useCallback(() => {
    if (!cv) return;
    const newAward: Award = {
      type: '',
      year: '',
      title: '',
      location: '',
    };
    handleChange({
      awards: [...(cv.cvData.awards || []), newAward],
    });
  }, [cv, handleChange]);

  const updateAward = useCallback((index: number, updates: Partial<Award>) => {
    if (!cv) return;
    const awards = [...(cv.cvData.awards || [])];
    awards[index] = { ...awards[index], ...updates };
    handleChange({ awards });
  }, [cv, handleChange]);

  const removeAward = useCallback((index: number) => {
    if (!cv) return;
    const awards = cv.cvData.awards?.filter((_, i) => i !== index) || [];
    handleChange({ awards });
  }, [cv, handleChange]);

  if (loading) {
    return (
      <div className="cv-profile-loading">
        Chargement...
      </div>
    );
  }

  const cvData = cv?.cvData || createEmptyCV();

  return (
    <>
      <ModuleHeader title={cv?.name || 'Mon CV'} onBack={handleBack}>
        <span className={`cv-save-status ${saving ? 'saving' : ''}`}>
          {saving ? 'Sauvegarde...' : 'Sauvegarde auto'}
        </span>
        <button
          className="module-header-btn"
          onClick={() => {
            if (cv?.id) {
              const embedUrl = `${window.location.origin}/mon-cv/?embed=${cv.id}`;
              navigator.clipboard.writeText(embedUrl);
              addToast({ type: 'success', message: 'Lien embed copie !' });
            }
          }}
          title="Copier le lien embed"
        >
          Embed
        </button>
        <button
          className="module-header-btn"
          onClick={() => setShowImport(true)}
        >
          Importer
        </button>
        <button
          className="module-header-btn"
          onClick={() => cv && onNavigate?.(`/mon-cv/adaptations/${cv.id}`)}
          title="Voir les adaptations de ce CV"
        >
          Adaptations
        </button>
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={() => onNavigate?.('/mon-cv/adapt')}
        >
          Adapter
        </button>
      </ModuleHeader>

      <div className="cv-profile-page">
        <div className="cv-profile-content">
          {/* Basic Info */}
          <ExpandableSection title="Informations de base" defaultExpanded>
            <div className="cv-profile-grid">
              <div className="cv-profile-photo-section">
                <ImageUploader
                  image={cvData.profilePhoto}
                  onChange={(img) => handleChange({ profilePhoto: img || '' })}
                  onUpload={handleUploadImage}
                  label="Photo"
                  size="medium"
                />
              </div>
              <div className="cv-profile-fields">
                <div className="cv-field">
                  <label>Nom complet</label>
                  <input
                    type="text"
                    value={cvData.name || ''}
                    onChange={(e) => handleChange({ name: e.target.value })}
                    placeholder="Jean Dupont"
                  />
                </div>
                <div className="cv-field">
                  <label>Titre professionnel</label>
                  <input
                    type="text"
                    value={cvData.title || ''}
                    onChange={(e) => handleChange({ title: e.target.value })}
                    placeholder="Developpeur Full Stack"
                  />
                </div>
              </div>
            </div>
            <div className="cv-field cv-field-full">
              <label>Resume</label>
              <textarea
                value={cvData.summary || ''}
                onChange={(e) => handleChange({ summary: e.target.value })}
                placeholder="Resume de votre parcours professionnel..."
                rows={4}
              />
            </div>
          </ExpandableSection>

          {/* Contact */}
          <ExpandableSection title="Contact">
            <div className="cv-profile-form-grid">
              <div className="cv-field">
                <label>Email</label>
                <input
                  type="email"
                  value={cvData.contact?.email || ''}
                  onChange={(e) => handleChange({
                    contact: { ...cvData.contact, email: e.target.value }
                  })}
                  placeholder="jean@example.com"
                />
              </div>
              <div className="cv-field">
                <label>Telephone</label>
                <input
                  type="tel"
                  value={cvData.contact?.phone || ''}
                  onChange={(e) => handleChange({
                    contact: { ...cvData.contact, phone: e.target.value }
                  })}
                  placeholder="+33 6 12 34 56 78"
                />
              </div>
              <div className="cv-field">
                <label>Adresse</label>
                <input
                  type="text"
                  value={cvData.contact?.address || ''}
                  onChange={(e) => handleChange({
                    contact: { ...cvData.contact, address: e.target.value }
                  })}
                  placeholder="123 Rue Example"
                />
              </div>
              <div className="cv-field">
                <label>Ville</label>
                <input
                  type="text"
                  value={cvData.contact?.city || ''}
                  onChange={(e) => handleChange({
                    contact: { ...cvData.contact, city: e.target.value }
                  })}
                  placeholder="Paris"
                />
              </div>
            </div>
          </ExpandableSection>

          {/* Skills */}
          <ExpandableSection
            title="Competences"
            badge={
              (cvData.languages?.length || 0) +
              (cvData.competences?.length || 0) +
              (cvData.outils?.length || 0) +
              (cvData.dev?.length || 0) +
              (cvData.frameworks?.length || 0) +
              (cvData.solutions?.length || 0)
            }
          >
            <div className="cv-skills-grid">
              <TagEditor
                label="Langues"
                tags={cvData.languages || []}
                onChange={(tags) => handleChange({ languages: tags })}
                placeholder="Ajouter une langue..."
              />
              <TagEditor
                label="Competences"
                tags={cvData.competences || []}
                onChange={(tags) => handleChange({ competences: tags })}
                placeholder="Ajouter une competence..."
              />
              <TagEditor
                label="Outils"
                tags={cvData.outils || []}
                onChange={(tags) => handleChange({ outils: tags })}
                placeholder="Ajouter un outil..."
              />
              <TagEditor
                label="Developpement"
                tags={cvData.dev || []}
                onChange={(tags) => handleChange({ dev: tags })}
                placeholder="Ajouter un langage..."
              />
              <TagEditor
                label="Frameworks"
                tags={cvData.frameworks || []}
                onChange={(tags) => handleChange({ frameworks: tags })}
                placeholder="Ajouter un framework..."
              />
              <TagEditor
                label="Solutions"
                tags={cvData.solutions || []}
                onChange={(tags) => handleChange({ solutions: tags })}
                placeholder="Ajouter une solution..."
              />
            </div>
          </ExpandableSection>

          {/* Experiences */}
          <ExpandableSection
            title="Experiences"
            badge={cvData.experiences?.length || 0}
          >
            <div className="cv-experiences">
              {cvData.experiences?.map((exp, index) => (
                <div key={index} className="cv-experience-item">
                  <div className="cv-experience-header">
                    <span className="cv-experience-number">#{index + 1}</span>
                    <button
                      type="button"
                      className="cv-experience-delete"
                      onClick={() => setDeleteExperienceConfirm(index)}
                    >
                      Supprimer
                    </button>
                  </div>
                  <div className="cv-profile-form-grid">
                    <div className="cv-field">
                      <label>Poste</label>
                      <input
                        type="text"
                        value={exp.title}
                        onChange={(e) => updateExperience(index, { title: e.target.value })}
                        placeholder="Developpeur Senior"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Entreprise</label>
                      <input
                        type="text"
                        value={exp.company}
                        onChange={(e) => updateExperience(index, { company: e.target.value })}
                        placeholder="Nom de l'entreprise"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Periode</label>
                      <input
                        type="text"
                        value={exp.period}
                        onChange={(e) => updateExperience(index, { period: e.target.value })}
                        placeholder="2020 - Present"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Lieu</label>
                      <input
                        type="text"
                        value={exp.location || ''}
                        onChange={(e) => updateExperience(index, { location: e.target.value })}
                        placeholder="Paris"
                      />
                    </div>
                  </div>
                  <div className="cv-field cv-field-full">
                    <label>Description</label>
                    <textarea
                      value={exp.description || ''}
                      onChange={(e) => updateExperience(index, { description: e.target.value })}
                      placeholder="Description du poste..."
                      rows={3}
                    />
                  </div>
                  <ListEditor
                    label="Missions"
                    items={exp.missions || []}
                    onChange={(items) => updateExperience(index, { missions: items })}
                    placeholder="Ajouter une mission..."
                  />
                  <ProjectEditor
                    label="Projets"
                    projects={exp.projects || []}
                    onChange={(projects) => updateExperience(index, { projects })}
                    placeholder="Ajouter un projet..."
                  />
                  <TagEditor
                    label="Technologies"
                    tags={exp.technologies || []}
                    onChange={(tags) => updateExperience(index, { technologies: tags })}
                    placeholder="Ajouter une technologie..."
                  />
                </div>
              ))}
              <button
                type="button"
                className="cv-add-btn"
                onClick={addExperience}
              >
                + Ajouter une experience
              </button>
            </div>
          </ExpandableSection>

          {/* Formations */}
          <ExpandableSection
            title="Formations"
            badge={cvData.formations?.length || 0}
          >
            <div className="cv-formations">
              {cvData.formations?.map((form, index) => (
                <div key={index} className="cv-formation-item">
                  <div className="cv-experience-header">
                    <span className="cv-experience-number">#{index + 1}</span>
                    <button
                      type="button"
                      className="cv-experience-delete"
                      onClick={() => removeFormation(index)}
                    >
                      Supprimer
                    </button>
                  </div>
                  <div className="cv-profile-form-grid">
                    <div className="cv-field">
                      <label>Diplome</label>
                      <input
                        type="text"
                        value={form.title}
                        onChange={(e) => updateFormation(index, { title: e.target.value })}
                        placeholder="Master en Informatique"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Etablissement</label>
                      <input
                        type="text"
                        value={form.school}
                        onChange={(e) => updateFormation(index, { school: e.target.value })}
                        placeholder="Universite Paris-Saclay"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Periode</label>
                      <input
                        type="text"
                        value={form.period}
                        onChange={(e) => updateFormation(index, { period: e.target.value })}
                        placeholder="2015 - 2020"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Lieu</label>
                      <input
                        type="text"
                        value={form.location || ''}
                        onChange={(e) => updateFormation(index, { location: e.target.value })}
                        placeholder="Paris"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="cv-add-btn"
                onClick={addFormation}
              >
                + Ajouter une formation
              </button>
            </div>
          </ExpandableSection>

          {/* Awards */}
          <ExpandableSection
            title="Distinctions"
            badge={cvData.awards?.length || 0}
          >
            <div className="cv-awards">
              {cvData.awards?.map((award, index) => (
                <div key={index} className="cv-award-item">
                  <div className="cv-experience-header">
                    <span className="cv-experience-number">#{index + 1}</span>
                    <button
                      type="button"
                      className="cv-experience-delete"
                      onClick={() => removeAward(index)}
                    >
                      Supprimer
                    </button>
                  </div>
                  <div className="cv-profile-form-grid">
                    <div className="cv-field">
                      <label>Type</label>
                      <input
                        type="text"
                        value={award.type}
                        onChange={(e) => updateAward(index, { type: e.target.value })}
                        placeholder="Certification"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Titre</label>
                      <input
                        type="text"
                        value={award.title}
                        onChange={(e) => updateAward(index, { title: e.target.value })}
                        placeholder="AWS Solutions Architect"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Annee</label>
                      <input
                        type="text"
                        value={award.year}
                        onChange={(e) => updateAward(index, { year: e.target.value })}
                        placeholder="2023"
                      />
                    </div>
                    <div className="cv-field">
                      <label>Lieu</label>
                      <input
                        type="text"
                        value={award.location || ''}
                        onChange={(e) => updateAward(index, { location: e.target.value })}
                        placeholder="En ligne"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="cv-add-btn"
                onClick={addAward}
              >
                + Ajouter une distinction
              </button>
            </div>
          </ExpandableSection>

          {/* Side Projects */}
          <ExpandableSection title="Projets personnels">
            <div className="cv-field">
              <label>Titre</label>
              <input
                type="text"
                value={cvData.sideProjects?.title || ''}
                onChange={(e) => handleChange({
                  sideProjects: { ...cvData.sideProjects, items: cvData.sideProjects?.items || [], title: e.target.value }
                })}
                placeholder="Mes projets personnels"
              />
            </div>
            <div className="cv-field cv-field-full">
              <label>Description</label>
              <textarea
                value={cvData.sideProjects?.description || ''}
                onChange={(e) => handleChange({
                  sideProjects: { ...cvData.sideProjects, items: cvData.sideProjects?.items || [], description: e.target.value }
                })}
                placeholder="Description de vos projets..."
                rows={3}
              />
            </div>
            <TagEditor
              label="Technologies"
              tags={cvData.sideProjects?.technologies || []}
              onChange={(tags) => handleChange({
                sideProjects: { ...cvData.sideProjects, items: cvData.sideProjects?.items || [], technologies: tags }
              })}
              placeholder="Ajouter une technologie..."
            />
          </ExpandableSection>

          {/* Export Section */}
          <ExportSection cvData={cvData} />
        </div>
      </div>

      {/* Modals */}
      {showImport && (
        <ImportCVModal
          onClose={() => setShowImport(false)}
          onImport={handleImportComplete}
        />
      )}

      {deleteExperienceConfirm !== null && (
        <ConfirmModal
          title="Supprimer l'experience"
          message="Etes-vous sur de vouloir supprimer cette experience ?"
          confirmLabel="Supprimer"
          danger
          onConfirm={() => removeExperience(deleteExperienceConfirm)}
          onCancel={() => setDeleteExperienceConfirm(null)}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </>
  );
}
