import { useState, useEffect } from 'react';
import { ModuleHeader, Card, Modal, FormField, Button, ConfirmModal, ToastContainer, LoadingSpinner } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { fetchBoards, createBoard, deleteBoardApi } from '../../services/api';
import type { Board } from '../../services/api';
import './BoardList.css';

interface BoardListProps {
  onSelect: (board: Board) => void;
  onNavigate?: (path: string) => void;
}

export function BoardList({ onSelect, onNavigate }: BoardListProps) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Board | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...toast, id: Date.now().toString() }]);
  };

  useEffect(() => {
    loadBoards();
  }, []);

  const loadBoards = async () => {
    setLoading(true);
    try {
      const data = await fetchBoards();
      setBoards(data);
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors du chargement' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const board = await createBoard(newName.trim());
      setBoards(prev => [board, ...prev]);
      setShowCreateForm(false);
      setNewName('');
      addToast({ type: 'success', message: `Board "${board.name}" créé` });
      onSelect(board);
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la création' });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, board: Board) => {
    e.stopPropagation();
    setDeleteConfirm(board);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    const name = deleteConfirm.name;
    setDeleting(true);
    try {
      await deleteBoardApi(deleteConfirm.id);
      setBoards(prev => prev.filter(b => b.id !== deleteConfirm.id));
      setDeleteConfirm(null);
      addToast({ type: 'success', message: `"${name}" supprimé` });
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la suppression' });
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <ModuleHeader
        title="Delivery"
        subtitle={loading ? '' : `${boards.length} board${boards.length > 1 ? 's' : ''}`}
        onBack={() => onNavigate?.('/')}
      >
        <button
          className="module-header-btn module-header-btn-primary"
          onClick={() => setShowCreateForm(true)}
        >
          + Nouveau board
        </button>
      </ModuleHeader>

      <div className="delivery-list-page">
        {loading ? (
          <LoadingSpinner message="Chargement..." />
        ) : boards.length === 0 ? (
          <Card className="delivery-list-empty-card">
            <div className="delivery-list-empty-content">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="9" y1="21" x2="9" y2="9" />
              </svg>
              <p className="delivery-list-empty-title">Aucun board</p>
              <p className="delivery-list-empty-hint">Créez votre premier board de livraison pour commencer</p>
              <Button variant="primary" onClick={() => setShowCreateForm(true)}>
                + Nouveau board
              </Button>
            </div>
          </Card>
        ) : (
          <div className="delivery-list-items">
            {boards.map(board => (
              <Card
                key={board.id}
                variant="interactive"
                onClick={() => onSelect(board)}
                className="delivery-list-doc-card"
              >
                <div className="shared-card__icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </div>
                <div className="shared-card__content">
                  <span className="shared-card__title">{board.name}</span>
                </div>
                <button
                  className="shared-card__edit-btn"
                  onClick={(e) => { e.stopPropagation(); onSelect(board); }}
                  title="Modifier"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  className="shared-card__delete-btn"
                  onClick={(e) => handleDeleteClick(e, board)}
                  title="Supprimer"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <div className="shared-card__arrow">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showCreateForm && (
        <Modal title="Nouveau board" onClose={() => { setShowCreateForm(false); setNewName(''); }}>
          <div className="delivery-list-modal-body">
            <FormField label="Nom du board" required>
              <input
                type="text"
                placeholder="Ex: Sprint Q2 2026"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
            </FormField>
            <div className="delivery-list-modal-actions">
              <Button variant="secondary" onClick={() => { setShowCreateForm(false); setNewName(''); }}>
                Annuler
              </Button>
              <Button variant="primary" onClick={handleCreate} disabled={!newName.trim() || creating}>
                {creating ? 'Création...' : 'Créer'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Supprimer le board"
          message={`Êtes-vous sûr de vouloir supprimer "${deleteConfirm.name}" ? Cette action est irréversible.`}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteConfirm(null)}
          confirmLabel={deleting ? 'Suppression...' : 'Supprimer'}
          danger
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}
