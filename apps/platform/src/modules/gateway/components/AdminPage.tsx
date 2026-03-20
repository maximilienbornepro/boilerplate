import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { ConfirmModal } from '@boilerplate/shared/components';
import { APPS } from '../constants';

interface User {
  id: number;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
  permissions: string[];
}

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

  useEffect(() => {
    loadUsers();
  }, []);

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
