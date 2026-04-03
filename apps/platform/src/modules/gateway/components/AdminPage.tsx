import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { ConfirmModal, APPS, ModuleHeader, Card, Badge, Button, SectionTitle, ExpandableSection, LoadingSpinner, ToastContainer } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';

interface User {
  id: number;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  permissions: string[];
}

interface PlatformSetting {
  key: string;
  value: string;
  description: string;
  updated_at: string;
}

const INTEGRATION_LABELS: Record<string, string> = {
  integration_roadmap_suivitess: 'Roadmap ↔ SuiviTess',
};

const INTEGRATION_DESCRIPTIONS: Record<string, string> = {
  integration_roadmap_suivitess: 'Lier des tâches Roadmap à des sujets SuiviTess et les éditer depuis Roadmap',
};

const APP_LABELS: Record<string, string> = Object.fromEntries(
  APPS.map(app => [app.id, app.name])
);
APP_LABELS['admin'] = 'Administration';

export function AdminPage({ onBack }: { onBack: () => void }) {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSetting[]>([]);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    setToasts(prev => [...prev, { ...toast, id: Date.now().toString() }]);
  };

  const availableApps = [...APPS.map(a => a.id), 'admin'];

  const loadUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) throw new Error('Erreur lors du chargement');
      const data = await res.json();
      setUsers(data);
    } catch {
      addToast({ type: 'error', message: 'Impossible de charger les utilisateurs' });
    } finally {
      setLoading(false);
    }
  };

  const loadPlatformSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/platform/settings', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setPlatformSettings(data);
    } catch {
      addToast({ type: 'error', message: 'Impossible de charger les paramètres' });
    }
  }, []);

  const toggleIntegration = useCallback(async (key: string, currentValue: string) => {
    const newValue = currentValue === 'true' ? 'false' : 'true';
    try {
      const res = await fetch(`/api/platform/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: newValue }),
      });
      if (!res.ok) throw new Error();
      setPlatformSettings(prev =>
        prev.map(s => s.key === key ? { ...s, value: newValue } : s)
      );
      addToast({ type: 'success', message: `Intégration ${newValue === 'true' ? 'activée' : 'désactivée'}` });
    } catch {
      addToast({ type: 'error', message: 'Erreur lors de la mise à jour' });
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadPlatformSettings();
  }, [loadPlatformSettings]);

  const toggleUserStatus = async (userId: number, currentStatus: boolean) => {
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus }),
        credentials: 'include',
      });
      await loadUsers();
      addToast({ type: 'success', message: `Utilisateur ${!currentStatus ? 'activé' : 'désactivé'}` });
    } catch {
      addToast({ type: 'error', message: 'Erreur lors de la mise à jour' });
    }
  };

  const togglePermission = async (userId: number, appId: string, currentPermissions: string[]) => {
    const newPermissions = currentPermissions.includes(appId)
      ? currentPermissions.filter(p => p !== appId)
      : [...currentPermissions, appId];

    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: newPermissions }),
        credentials: 'include',
      });
      await loadUsers();
    } catch {
      addToast({ type: 'error', message: 'Erreur lors de la mise à jour' });
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
    const email = userToDelete.email;
    try {
      const res = await fetch(`/api/admin/users/${userToDelete.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur lors de la suppression');
      }
      setUserToDelete(null);
      await loadUsers();
      addToast({ type: 'success', message: `"${email}" supprimé` });
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur lors de la suppression' });
      setUserToDelete(null);
    }
  };

  if (loading) {
    return (
      <>
        <ModuleHeader title="Administration" onBack={onBack} />
        <div className="admin-page">
          <LoadingSpinner message="Chargement des utilisateurs..." />
        </div>
      </>
    );
  }

  return (
    <>
      <ModuleHeader title="Administration" subtitle={`${users.length} utilisateur${users.length > 1 ? 's' : ''}`} onBack={onBack} />

      <div className="admin-page">
        {/* Users */}
        <section className="admin-section">
          <SectionTitle>Utilisateurs</SectionTitle>
          <div className="admin-users">
            {users.map(user => (
              <Card key={user.id} className="admin-user-card">
                {/* Header row: icon + info + actions */}
                <div className="admin-user-row">
                  <div className="shared-card__icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div className="admin-user-info">
                    <div className="admin-user-name-row">
                      <span className="shared-card__title">{user.email}</span>
                      {user.isAdmin && <Badge type="accent">Admin</Badge>}
                      <Badge type={user.isActive ? 'success' : 'error'}>
                        {user.isActive ? 'Actif' : 'Inactif'}
                      </Badge>
                    </div>
                    <span className="shared-card__subtitle">
                      Créé le {new Date(user.createdAt).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                  {user.id !== currentUser?.id && (
                    <div className="admin-user-actions">
                      <Button
                        variant={user.isActive ? 'secondary' : 'primary'}
                        onClick={() => toggleUserStatus(user.id, user.isActive)}
                      >
                        {user.isActive ? 'Désactiver' : 'Activer'}
                      </Button>
                      <Button variant="danger" onClick={() => setUserToDelete(user)}>
                        Supprimer
                      </Button>
                    </div>
                  )}
                </div>

                {/* Permissions — collapsed by default */}
                <ExpandableSection
                  title="Permissions"
                  badge={user.permissions.length}
                >
                  <div className="admin-permissions-grid">
                    {availableApps.map(appId => (
                      <label key={appId} className="admin-permission-item">
                        <input
                          type="checkbox"
                          checked={user.permissions.includes(appId)}
                          onChange={() => togglePermission(user.id, appId, user.permissions)}
                          disabled={user.id === currentUser?.id && appId === 'admin'}
                        />
                        <span>{APP_LABELS[appId] || appId}</span>
                      </label>
                    ))}
                  </div>
                </ExpandableSection>
              </Card>
            ))}
          </div>
        </section>

        {/* Platform Integrations */}
        <section className="admin-section">
          <SectionTitle>Intégrations inter-modules</SectionTitle>
          <p className="admin-section-description">Activez ou désactivez les liaisons entre modules.</p>

          <div className="admin-integrations">
            {platformSettings.filter(s => s.key.startsWith('integration_')).map(setting => (
              <Card key={setting.key} className="admin-integration-row">
                <div className="admin-integration-info">
                  <span className="shared-card__title">
                    {INTEGRATION_LABELS[setting.key] || setting.key}
                  </span>
                  <span className="shared-card__subtitle">
                    {INTEGRATION_DESCRIPTIONS[setting.key] || setting.description}
                  </span>
                </div>
                <Button
                  variant={setting.value === 'true' ? 'primary' : 'secondary'}
                  onClick={() => toggleIntegration(setting.key, setting.value)}
                >
                  {setting.value === 'true' ? 'Activée' : 'Désactivée'}
                </Button>
              </Card>
            ))}
            {platformSettings.filter(s => s.key.startsWith('integration_')).length === 0 && (
              <p className="admin-empty">Aucune intégration disponible</p>
            )}
          </div>
        </section>
      </div>

      {userToDelete && (
        <ConfirmModal
          title="Supprimer l'utilisateur"
          message={`Êtes-vous sûr de vouloir supprimer "${userToDelete.email}" ? Cette action est irréversible.`}
          confirmLabel="Supprimer"
          cancelLabel="Annuler"
          onConfirm={handleDeleteUser}
          onCancel={() => setUserToDelete(null)}
          danger
        />
      )}

      <ToastContainer toasts={toasts} onDismiss={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </>
  );
}
