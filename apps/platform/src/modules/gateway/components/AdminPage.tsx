import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { ConfirmModal, APPS } from '@boilerplate/shared/components';

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
  const [error, setError] = useState('');
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSetting[]>([]);
  const [settingsError, setSettingsError] = useState('');

  const availableApps = [...APPS.map(a => a.id), 'admin'];

  const loadUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', { credentials: 'include' });
      if (!res.ok) throw new Error('Erreur lors du chargement');
      const data = await res.json();
      setUsers(data);
    } catch {
      setError('Impossible de charger les utilisateurs');
    } finally {
      setLoading(false);
    }
  };

  const loadPlatformSettings = useCallback(async () => {
    try {
      const res = await fetch('/gateway-api/platform/settings', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setPlatformSettings(data);
    } catch {
      setSettingsError('Impossible de charger les paramètres');
    }
  }, []);

  const toggleIntegration = useCallback(async (key: string, currentValue: string) => {
    const newValue = currentValue === 'true' ? 'false' : 'true';
    try {
      const res = await fetch(`/gateway-api/platform/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ value: newValue }),
      });
      if (!res.ok) throw new Error();
      setPlatformSettings(prev =>
        prev.map(s => s.key === key ? { ...s, value: newValue } : s)
      );
    } catch {
      setSettingsError('Erreur lors de la mise à jour');
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
    } catch {
      setError('Erreur lors de la mise à jour');
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
      setError('Erreur lors de la mise à jour');
    }
  };

  const handleDeleteUser = async () => {
    if (!userToDelete) return;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression');
      setUserToDelete(null);
    }
  };

  if (loading) {
    return (
      <div className="admin-page">
        <div className="admin-loading">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <button className="admin-back" onClick={onBack}>
          &#x2190; Retour
        </button>
        <h1 className="admin-title">Administration des utilisateurs</h1>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-users">
        {users.map(user => (
          <div key={user.id} className={`admin-user-card ${user.isActive ? 'active' : 'inactive'}`}>
            <div className="admin-user-header">
              <div className="admin-user-info">
                <span className="admin-user-email">{user.email}</span>
                {user.isAdmin && <span className="admin-badge admin">Admin</span>}
                <span className={`admin-badge ${user.isActive ? 'active' : 'inactive'}`}>
                  {user.isActive ? 'Actif' : 'Inactif'}
                </span>
              </div>
              <div className="admin-user-date">
                Créé le {new Date(user.createdAt).toLocaleDateString('fr-FR')}
              </div>
            </div>

            <div className="admin-user-actions">
              {user.id !== currentUser?.id && (
                <>
                  <button
                    className={`admin-toggle-btn ${user.isActive ? 'deactivate' : 'activate'}`}
                    onClick={() => toggleUserStatus(user.id, user.isActive)}
                  >
                    {user.isActive ? 'Désactiver' : 'Activer'}
                  </button>
                  <button
                    className="admin-toggle-btn delete"
                    onClick={() => setUserToDelete(user)}
                  >
                    Supprimer
                  </button>
                </>
              )}
            </div>

            <div className="admin-permissions">
              <div className="admin-permissions-title">Permissions :</div>
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
            </div>
          </div>
        ))}
      </div>

      {/* Platform Integrations */}
      <div className="admin-section">
        <h2 className="admin-section-title">Intégrations inter-modules</h2>
        <p className="admin-section-description">Activez ou désactivez les liaisons entre modules. Chaque module reste utilisable indépendamment.</p>

        {settingsError && <div className="admin-error">{settingsError}</div>}

        <div className="admin-integrations">
          {platformSettings.filter(s => s.key.startsWith('integration_')).map(setting => (
            <div key={setting.key} className="admin-integration-row">
              <div className="admin-integration-info">
                <span className="admin-integration-label">
                  {INTEGRATION_LABELS[setting.key] || setting.key}
                </span>
                <span className="admin-integration-desc">
                  {INTEGRATION_DESCRIPTIONS[setting.key] || setting.description}
                </span>
              </div>
              <button
                className={`admin-integration-toggle ${setting.value === 'true' ? 'on' : 'off'}`}
                onClick={() => toggleIntegration(setting.key, setting.value)}
              >
                {setting.value === 'true' ? 'Activée' : 'Désactivée'}
              </button>
            </div>
          ))}
          {platformSettings.filter(s => s.key.startsWith('integration_')).length === 0 && (
            <div className="admin-empty">Aucune intégration disponible</div>
          )}
        </div>
      </div>

      {userToDelete && (
        <ConfirmModal
          title="Supprimer l'utilisateur"
          message={`Êtes-vous sûr de vouloir supprimer l'utilisateur "${userToDelete.email}" ? Cette action est irréversible.`}
          confirmLabel="Supprimer"
          cancelLabel="Annuler"
          onConfirm={handleDeleteUser}
          onCancel={() => setUserToDelete(null)}
          danger
        />
      )}
    </div>
  );
}
