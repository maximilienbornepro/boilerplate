import { useState } from 'react';
import {
  Layout,
  ModuleHeader,
  Card,
  Modal,
  FormField,
  ToastContainer,
  LoadingSpinner,
} from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import './App.css';

interface DemoItem {
  id: number;
  title: string;
  description: string;
  status: 'actif' | 'inactif' | 'brouillon';
  createdAt: string;
}

const MOCK_ITEMS: DemoItem[] = [
  { id: 1, title: 'Premier élément', description: 'Description du premier élément de la liste', status: 'actif', createdAt: '2026-04-01' },
  { id: 2, title: 'Deuxième élément', description: 'Un autre élément avec plus de détails ici', status: 'inactif', createdAt: '2026-04-02' },
  { id: 3, title: 'Troisième élément', description: 'Encore un élément pour démontrer la liste', status: 'brouillon', createdAt: '2026-04-03' },
];

export default function DemoApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return (
    <Layout appId="demo" variant="full-width" onNavigate={onNavigate}>
      <AppContent onNavigate={onNavigate} />
    </Layout>
  );
}

function AppContent({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const [items, setItems] = useState<DemoItem[]>(MOCK_ITEMS);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [loading] = useState(false);

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...toast, id: Date.now().toString() }]);
  };

  const handleCreate = () => {
    if (!newTitle.trim()) return;
    const newItem: DemoItem = {
      id: Date.now(),
      title: newTitle,
      description: newDescription,
      status: 'brouillon',
      createdAt: new Date().toISOString().split('T')[0],
    };
    setItems(prev => [newItem, ...prev]);
    setShowCreateModal(false);
    setNewTitle('');
    setNewDescription('');
    addToast({ type: 'success', message: 'Élément créé avec succès' });
  };

  const handleDelete = (id: number) => {
    setItems(prev => prev.filter(item => item.id !== id));
    addToast({ type: 'info', message: 'Élément supprimé' });
  };

  const statusColor: Record<string, string> = {
    actif: 'var(--success)',
    inactif: 'var(--text-muted)',
    brouillon: 'var(--warning)',
  };

  if (loading) {
    return <LoadingSpinner message="Chargement..." />;
  }

  return (
    <div className="demo-page">
      <ModuleHeader title="Page Démo" subtitle="Liste avec création" onBack={() => onNavigate?.('/')}>
        <button className="module-header-btn module-header-btn-primary" onClick={() => setShowCreateModal(true)}>
          + Créer
        </button>
      </ModuleHeader>

      <div className="demo-content">
        <div className="demo-stats" data-custom="stats-bar">
          <span className="demo-stat" data-custom="stat-badge">{items.length} élément{items.length > 1 ? 's' : ''}</span>
          <span className="demo-stat demo-stat--success" data-custom="stat-badge-success">{items.filter(i => i.status === 'actif').length} actif{items.filter(i => i.status === 'actif').length > 1 ? 's' : ''}</span>
        </div>

        <div className="demo-list">
          {items.map(item => (
            <Card key={item.id} variant="interactive" className="demo-card">
              <div className="demo-card-header">
                <h3 className="demo-card-title">{item.title}</h3>
                <span className="demo-card-status" data-custom="status-label" style={{ color: statusColor[item.status] }}>
                  {item.status}
                </span>
              </div>
              <p className="demo-card-description">{item.description}</p>
              <div className="demo-card-footer" data-custom="card-footer">
                <span className="demo-card-date" data-custom="date-label">{item.createdAt}</span>
                <button className="demo-card-delete" data-custom="delete-btn" onClick={() => handleDelete(item.id)}>
                  Supprimer
                </button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {showCreateModal && (
        <Modal title="Créer un élément" onClose={() => setShowCreateModal(false)}>
          <div className="demo-form" data-custom="form-layout">
            <FormField label="Titre" required>
              <input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Titre de l'élément"
                autoFocus
              />
            </FormField>
            <FormField label="Description">
              <textarea
                value={newDescription}
                onChange={e => setNewDescription(e.target.value)}
                placeholder="Description optionnelle"
                rows={3}
              />
            </FormField>
            <div className="demo-form-actions" data-custom="form-actions">
              <button className="demo-btn demo-btn--secondary" data-custom="cancel-btn" onClick={() => setShowCreateModal(false)}>
                Annuler
              </button>
              <button className="demo-btn demo-btn--primary" data-custom="submit-btn" onClick={handleCreate} disabled={!newTitle.trim()}>
                Créer
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </div>
  );
}
