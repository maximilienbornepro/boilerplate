import { useState, useEffect, useRef } from 'react';
import { ModuleHeader, Modal, ConfirmModal } from '@boilerplate/shared/components';
import type { CVListItem } from '../../types';
import { createEmptyCV } from '../../types';
import * as api from '../../services/api';
import './CVListPage.css';

interface CVListPageProps {
  onEdit: (cvId: number) => void;
  onAdapt: (cvId: number) => void;
  onAdaptations: (cvId: number) => void;
  onBack: () => void;
}

function formatRelativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 2) return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function CVListPage({ onEdit, onAdapt, onAdaptations, onBack }: CVListPageProps) {
  const [cvs, setCvs] = useState<CVListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [newCvName, setNewCvName] = useState('');
  const [creating, setCreating] = useState(false);

  // Inline rename
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Dropdown menus
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  // Delete confirm
  const [confirmDelete, setConfirmDelete] = useState<CVListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Adaptation counts
  const [adaptCounts, setAdaptCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    loadCVs();
    const handler = () => setOpenMenuId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  useEffect(() => {
    if (renamingId !== null) {
      setTimeout(() => renameInputRef.current?.focus(), 0);
    }
  }, [renamingId]);

  const loadCVs = async () => {
    setLoading(true);
    setError('');
    try {
      const list = await api.fetchAllCVs();
      setCvs(list);
      loadAdaptCounts(list);
      if (list.length === 0) setShowCreate(true);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  const loadAdaptCounts = async (list: CVListItem[]) => {
    const counts: Record<number, number> = {};
    await Promise.all(
      list.map(async cv => {
        try { counts[cv.id] = await api.getAdaptationsCount(cv.id); }
        catch { counts[cv.id] = 0; }
      })
    );
    setAdaptCounts(counts);
  };

  const handleCreate = async () => {
    const name = newCvName.trim() || 'Nouveau CV';
    setCreating(true);
    setError('');
    try {
      const created = await api.createCV(name, createEmptyCV(), false);
      setShowCreate(false);
      setNewCvName('');
      onEdit(created.id);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  };

  const handleRenameStart = (cv: CVListItem) => {
    setRenamingId(cv.id);
    setRenameValue(cv.name);
    setOpenMenuId(null);
  };

  const handleRenameConfirm = async (cvId: number) => {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenamingId(null); return; }
    try {
      const updated = await api.updateCV(cvId, { name: trimmed });
      setCvs(prev => prev.map(c => c.id === cvId ? { ...c, name: updated.name } : c));
    } catch (err: any) {
      setError(err.message || 'Erreur lors du renommage');
    } finally {
      setRenamingId(null);
    }
  };

  const handleSetDefault = async (cvId: number) => {
    setOpenMenuId(null);
    try {
      await api.setDefaultCV(cvId);
      setCvs(prev => prev.map(c => ({ ...c, isDefault: c.id === cvId })));
    } catch (err: any) {
      setError(err.message || 'Erreur');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await api.deleteCV(confirmDelete.id);
      setCvs(prev => prev.filter(c => c.id !== confirmDelete.id));
      setConfirmDelete(null);
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la suppression');
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ModuleHeader
        title="Mes CV"
        subtitle={loading ? '' : `${cvs.length} CV${cvs.length > 1 ? 's' : ''}`}
        onBack={onBack}
      >
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={() => setShowCreate(true)}
        >
          + Nouveau CV
        </button>
      </ModuleHeader>

      <div className="cv-list-page">
        {error && <div className="cv-list-error">{error}</div>}

        {loading ? (
          <div className="cv-list-loading">Chargement...</div>
        ) : cvs.length === 0 ? (
          <div className="cv-list-empty">
            <div className="cv-list-empty-icon">📄</div>
            <p className="cv-list-empty-title">Aucun CV</p>
            <p className="cv-list-empty-text">Créez votre premier CV pour commencer.</p>
          </div>
        ) : (
          <div className="cv-list-grid">
            {cvs.map(cv => (
              <div
                key={cv.id}
                className={`cv-list-card${cv.isDefault ? ' cv-list-card--default' : ''}`}
              >
                {/* Icon */}
                <div className="cv-list-card__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                </div>

                {/* Body */}
                <div className="cv-list-card__body">
                  {/* Top: name + menu */}
                  <div className="cv-list-card__top">
                    <div className="cv-list-card__name-area">
                      {renamingId === cv.id ? (
                        <input
                          ref={renameInputRef}
                          className="cv-list-card__rename-input"
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleRenameConfirm(cv.id);
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          onBlur={() => handleRenameConfirm(cv.id)}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <span className="cv-list-card__name">
                          {cv.isDefault && <span className="cv-list-card__star">★</span>}
                          {cv.name}
                        </span>
                      )}
                      {cv.isDefault && (
                        <span className="cv-list-card__badge">Par défaut</span>
                      )}
                    </div>

                    {/* ⋯ menu */}
                    <div className="cv-list-menu" onClick={e => e.stopPropagation()}>
                      <button
                        className="cv-list-menu__trigger"
                        onClick={() => setOpenMenuId(openMenuId === cv.id ? null : cv.id)}
                      >
                        ···
                      </button>
                      {openMenuId === cv.id && (
                        <div className="cv-list-menu__dropdown">
                          <button onClick={() => handleRenameStart(cv)}>Renommer</button>
                          {!cv.isDefault && (
                            <button onClick={() => handleSetDefault(cv.id)}>
                              Définir par défaut
                            </button>
                          )}
                          {!cv.isDefault ? (
                            <button
                              className="cv-list-menu__item--danger"
                              onClick={() => { setConfirmDelete(cv); setOpenMenuId(null); }}
                            >
                              Supprimer
                            </button>
                          ) : (
                            <span className="cv-list-menu__note">Non supprimable (défaut)</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="cv-list-card__meta">
                    Modifié {formatRelativeDate(cv.updatedAt)}
                  </div>

                  {/* Actions */}
                  <div className="cv-list-card__actions">
                    <button
                      className="module-header-btn module-header-btn-primary cv-list-card__btn"
                      onClick={() => onEdit(cv.id)}
                    >
                      Éditer
                    </button>
                    <button
                      className="module-header-btn cv-list-card__btn"
                      onClick={() => onAdapt(cv.id)}
                    >
                      Adapter
                    </button>
                    <button
                      className="module-header-btn cv-list-card__btn cv-list-card__btn--adapt"
                      onClick={() => onAdaptations(cv.id)}
                    >
                      Adaptations
                      {adaptCounts[cv.id] !== undefined && adaptCounts[cv.id] > 0 && (
                        <span className="cv-list-adapt-count">{adaptCounts[cv.id]}</span>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <Modal title="Nouveau CV" onClose={() => { setShowCreate(false); setNewCvName(''); }}>
          <div className="cv-list-modal-body">
            <label className="cv-list-modal-label">Nom du CV</label>
            <input
              className="cv-list-modal-input"
              type="text"
              placeholder="Ex : CV Développeur, CV Manager..."
              value={newCvName}
              onChange={e => setNewCvName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') { setShowCreate(false); setNewCvName(''); }
              }}
              autoFocus
            />
            <div className="cv-list-modal-actions">
              <button
                className="module-header-btn"
                onClick={() => { setShowCreate(false); setNewCvName(''); }}
              >
                Annuler
              </button>
              <button
                className="module-header-btn module-header-btn-primary"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? 'Création...' : 'Créer et éditer'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <ConfirmModal
          title={`Supprimer "${confirmDelete.name}" ?`}
          message="Ce CV et toutes ses adaptations seront supprimés définitivement."
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
          confirmLabel={deleting ? 'Suppression...' : 'Supprimer'}
          variant="danger"
        />
      )}
    </>
  );
}
