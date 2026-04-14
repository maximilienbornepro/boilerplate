import { useState, useEffect, useMemo } from 'react';
import { ModuleHeader, Card, Modal, FormField, Button, ConfirmModal, ToastContainer, LoadingSpinner, ExpandableSection, SharingModal, VisibilityPicker } from '@boilerplate/shared/components';
import type { Visibility } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { fetchBoards, createBoard, updateBoardApi, deleteBoardApi } from '../../services/api';
import type { Board, BoardType } from '../../services/api';
import './BoardList.css';

// ── Quarter grouping helpers ──────────────────────────────────────────

const QUARTER_LABELS = ['T1', 'T2', 'T3', 'T4'];
const MONTH_NAMES_SHORT = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
const MONTH_NAMES_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function getQuarterKey(startDate: string | null): string {
  if (!startDate) return 'Non daté';
  const [y, m] = startDate.split('-').map(Number);
  const q = Math.ceil(m / 3);
  return `${QUARTER_LABELS[q - 1]} ${y}`;
}

/** Sort key for quarters: "T2 2026" → "2026-2", "Non daté" → "9999-9" */
function quarterSortKey(label: string): string {
  if (label === 'Non daté') return '9999-9';
  const match = label.match(/T(\d) (\d{4})/);
  if (!match) return '9999-9';
  return `${match[2]}-${match[1]}`;
}

function groupBoardsByQuarter(boards: Board[]): Array<[string, Board[]]> {
  const groups = new Map<string, Board[]>();
  for (const board of boards) {
    const key = getQuarterKey(board.startDate);
    const group = groups.get(key) ?? [];
    group.push(board);
    groups.set(key, group);
  }
  // Sort quarters: most recent first. Boards within each quarter: startDate desc.
  return Array.from(groups.entries())
    .sort(([a], [b]) => quarterSortKey(b).localeCompare(quarterSortKey(a)))
    .map(([key, groupBoards]) => [
      key,
      groupBoards.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')),
    ]);
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '?';
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES_SHORT[m - 1]}`;
}

function formatBoardPeriod(board: Board): string {
  if (board.boardType === 'calendaire' && board.startDate) {
    const [, m] = board.startDate.split('-').map(Number);
    const [y] = board.startDate.split('-');
    return `${MONTH_NAMES_FULL[m - 1]} ${y}`;
  }
  if (board.startDate && board.endDate) {
    return `${formatDateShort(board.startDate)} → ${formatDateShort(board.endDate)}`;
  }
  return '';
}

function formatDuration(board: Board): string {
  if (board.boardType === 'calendaire') return '1 mois';
  if (board.durationWeeks) return `${board.durationWeeks} sem`;
  return '';
}

interface BoardListProps {
  onSelect: (board: Board) => void;
  onNavigate?: (path: string) => void;
}

export function BoardList({ onSelect, onNavigate: _onNavigate }: BoardListProps) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newBoardType, setNewBoardType] = useState<BoardType>('agile');
  const [newStartDate, setNewStartDate] = useState(() => {
    const d = new Date();
    // Default to next Monday
    d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
    return d.toISOString().split('T')[0];
  });
  const [newStartDateTouched, setNewStartDateTouched] = useState(false);
  const [newDurationWeeks, setNewDurationWeeks] = useState(8);
  const [newMonth, setNewMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [newVisibility, setNewVisibility] = useState<Visibility>('private');
  const [creating, setCreating] = useState(false);
  const [editingBoard, setEditingBoard] = useState<Board | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Board | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [sharingBoard, setSharingBoard] = useState<Board | null>(null);

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...toast, id: Date.now().toString() }]);
  };

  const quarterGroups = useMemo(() => groupBoardsByQuarter(boards), [boards]);

  useEffect(() => {
    loadBoards();
  }, []);

  // Auto-open create modal if URL has ?create=1 (from Dashboard)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('create') === '1') {
      setShowCreateForm(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('create');
      window.history.replaceState({}, '', url.toString());
    }
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
      const startDate = newBoardType === 'calendaire'
        ? `${newMonth}-01`
        : newStartDate;
      const board = await createBoard(
        newName.trim(),
        newBoardType,
        startDate,
        newBoardType === 'agile' ? newDurationWeeks : undefined,
        newDescription.trim() || undefined,
        newVisibility,
      );
      setBoards(prev => [board, ...prev]);
      setShowCreateForm(false);
      setNewName('');
      setNewDescription('');
      addToast({ type: 'success', message: `Board "${board.name}" créé` });
      onSelect(board);
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la création' });
    } finally {
      setCreating(false);
    }
  };

  const handleEditClick = (e: React.MouseEvent, board: Board) => {
    e.stopPropagation();
    setEditingBoard(board);
    setEditName(board.name);
    setEditDescription(board.description ?? '');
  };

  const handleEditSave = async () => {
    if (!editingBoard || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const updated = await updateBoardApi(editingBoard.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      setBoards(prev => prev.map(b => b.id === updated.id ? updated : b));
      setEditingBoard(null);
      addToast({ type: 'success', message: 'Board modifié' });
    } catch (err: any) {
      addToast({ type: 'error', message: err.message || 'Erreur lors de la modification' });
    } finally {
      setSavingEdit(false);
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
      <ModuleHeader title="Delivery">
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
              <p className="delivery-list-empty-hint">Créer votre premier board de livraison pour commencer</p>
              <Button variant="primary" onClick={() => setShowCreateForm(true)}>
                + Nouveau board
              </Button>
            </div>
          </Card>
        ) : (
          <div className="delivery-list-items">
            {quarterGroups.map(([quarter, quarterBoards], index) => (
              <ExpandableSection
                key={quarter}
                title={quarter}
                badge={quarterBoards.length}
                defaultExpanded={index === 0}
              >
                <div className="delivery-list-quarter-boards">
                  {quarterBoards.map(board => (
                    <Card
                      key={board.id}
                      variant="interactive"
                      onClick={() => onSelect(board)}
                      className="delivery-list-doc-card"
                    >
                      <div className="shared-card__content">
                        <div className="delivery-list-title-row">
                          <span className="shared-card__title">{board.name}</span>
                          <span className={`delivery-list-badge-type delivery-list-badge-${board.boardType}`}>
                            {board.boardType === 'calendaire' ? 'Calendaire' : 'Agile'}
                          </span>
                        </div>
                        <div className="delivery-list-card-meta">
                          <span className="delivery-list-card-period">{formatBoardPeriod(board)}</span>
                          {formatDuration(board) && (
                            <span className="delivery-list-card-duration">{formatDuration(board)}</span>
                          )}
                        </div>
                        {board.description && <span className="shared-card__subtitle">{board.description}</span>}
                      </div>
                      <button
                        className="shared-card__edit-btn"
                        onClick={(e) => handleEditClick(e, board)}
                        title="Modifier"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        className="shared-card__edit-btn"
                        onClick={(e) => { e.stopPropagation(); setSharingBoard(board); }}
                        title="Partager"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                          <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
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
              </ExpandableSection>
            ))}
          </div>
        )}
      </div>

      {showCreateForm && (
        <Modal title="Nouveau board" onClose={() => { setShowCreateForm(false); setNewName(''); setNewDescription(''); setNewVisibility('private'); setNewStartDateTouched(false); }}>
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

            <FormField label="Type">
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                  <input type="radio" name="boardType" value="agile" checked={newBoardType === 'agile'} onChange={() => setNewBoardType('agile')} />
                  Agile
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
                  <input type="radio" name="boardType" value="calendaire" checked={newBoardType === 'calendaire'} onChange={() => setNewBoardType('calendaire')} />
                  Calendaire
                </label>
              </div>
            </FormField>

            {newBoardType === 'agile' ? (
              <>
                <FormField label="Date de début" required>
                  <input
                    type="date"
                    value={newStartDate}
                    onChange={e => { setNewStartDate(e.target.value); setNewStartDateTouched(true); }}
                    onBlur={() => setNewStartDateTouched(true)}
                    style={newStartDateTouched ? { color: 'var(--text-primary)' } : undefined}
                  />
                </FormField>
                <FormField label="Durée" required>
                  <select value={newDurationWeeks} onChange={e => setNewDurationWeeks(Number(e.target.value))}>
                    <option value={2}>2 semaines (1 sprint)</option>
                    <option value={4}>4 semaines (2 sprints)</option>
                    <option value={6}>6 semaines (3 sprints)</option>
                    <option value={8}>8 semaines (4 sprints)</option>
                  </select>
                </FormField>
              </>
            ) : (
              <FormField label="Mois" required>
                <input type="month" value={newMonth} onChange={e => setNewMonth(e.target.value)} />
              </FormField>
            )}

            <FormField label="Description">
              <textarea
                placeholder="Description optionnelle"
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                rows={2}
              />
            </FormField>
            <FormField label="Visibilité">
              <VisibilityPicker value={newVisibility} onChange={setNewVisibility} />
            </FormField>
            <div className="delivery-list-modal-actions">
              <Button variant="secondary" onClick={() => { setShowCreateForm(false); setNewName(''); setNewDescription(''); setNewVisibility('private'); setNewStartDateTouched(false); }}>
                Annuler
              </Button>
              <Button variant="primary" onClick={handleCreate} disabled={!newName.trim() || creating}>
                {creating ? 'Création...' : 'Créer'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {editingBoard && (
        <Modal title="Modifier le board" onClose={() => setEditingBoard(null)}>
          <div className="delivery-list-modal-body">
            <FormField label="Nom du board" required>
              <input
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEditSave()}
                autoFocus
              />
            </FormField>
            <FormField label="Description">
              <textarea
                placeholder="Description optionnelle"
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                rows={2}
              />
            </FormField>
            <div className="delivery-list-modal-actions">
              <Button variant="secondary" onClick={() => setEditingBoard(null)}>
                Annuler
              </Button>
              <Button variant="primary" onClick={handleEditSave} disabled={!editName.trim() || savingEdit}>
                {savingEdit ? 'Modification...' : 'Modifier'}
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

      {sharingBoard && (
        <SharingModal
          resourceType="delivery"
          resourceId={sharingBoard.id}
          resourceName={sharingBoard.name}
          onClose={() => setSharingBoard(null)}
          onUpdated={loadBoards}
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}
