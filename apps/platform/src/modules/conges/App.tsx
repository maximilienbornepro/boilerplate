import { useState, useEffect, useCallback, useMemo } from 'react';
import { Layout, ToastContainer, ConfirmModal, ModuleHeader, useGatewayUser } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { LeaveCalendar } from './components/LeaveCalendar/LeaveCalendar';
import { LeaveForm } from './components/LeaveForm/LeaveForm';
import { MemberList } from './components/MemberList/MemberList';
import { ViewControls } from './components/ViewControls/ViewControls';
import type { Member, Leave, LeaveFormData, ViewMode } from './types';
import * as api from './services/api';
import './index.css';

export default function CongesApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return (
    <Layout appId="conges" variant="full-width" onNavigate={onNavigate}>
      <AppContent onNavigate={onNavigate} />
    </Layout>
  );
}

function AppContent({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const { user } = useGatewayUser();

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [year, setYear] = useState(() => new Date().getFullYear());

  const [members, setMembers] = useState<Member[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);

  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [editingLeave, setEditingLeave] = useState<Leave | null>(null);
  const [showMemberList, setShowMemberList] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Leave | null>(null);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [scrollToTodayTrigger, setScrollToTodayTrigger] = useState(0);

  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const startDate = useMemo(() => `${year}-01-01`, [year]);
  const endDate = useMemo(() => `${year}-12-31`, [year]);

  const handleYearChange = useCallback((direction: -1 | 1) => {
    setYear((y) => y + direction);
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [membersData, leavesData] = await Promise.all([
        api.fetchMembers(),
        api.fetchLeaves(startDate, endDate),
      ]);
      setMembers(membersData);
      setLeaves(leavesData);
    } catch (err) {
      console.error('Failed to load data:', err);
      addToast({ type: 'error', message: 'Erreur lors du chargement des donnees' });
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleLeaveClick = useCallback((leave: Leave) => {
    if (!user?.isAdmin && leave.memberId !== user?.id) return;
    setEditingLeave(leave);
    setShowLeaveForm(true);
  }, [user]);

  const handleAddLeave = useCallback(() => {
    setEditingLeave(null);
    setShowLeaveForm(true);
  }, []);

  const handleLeaveSubmit = useCallback(async (data: LeaveFormData) => {
    try {
      if (editingLeave) {
        await api.updateLeave(editingLeave.id, data);
        addToast({ type: 'success', message: 'Conge modifie' });
      } else {
        await api.createLeave(data);
        addToast({ type: 'success', message: 'Conge ajoute' });
      }
      setShowLeaveForm(false);
      setEditingLeave(null);
      await loadData();
    } catch (err: any) {
      console.error('Failed to save leave:', err);
      addToast({ type: 'error', message: err.message || 'Erreur lors de la sauvegarde' });
    }
  }, [editingLeave, addToast, loadData]);

  const handleLeaveDelete = useCallback(() => {
    if (editingLeave) {
      setShowLeaveForm(false);
      setDeleteConfirm(editingLeave);
    }
  }, [editingLeave]);

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      await api.deleteLeave(deleteConfirm.id);
      addToast({ type: 'success', message: 'Conge supprime' });
      setDeleteConfirm(null);
      setEditingLeave(null);
      await loadData();
    } catch (err: any) {
      console.error('Failed to delete leave:', err);
      addToast({ type: 'error', message: err.message || 'Erreur lors de la suppression' });
    }
  }, [deleteConfirm, addToast, loadData]);

  const handleUpdateMember = useCallback(async (id: number, data: Partial<{ color: string; sortOrder: number }>) => {
    try {
      await api.updateMember(id, data);
      addToast({ type: 'success', message: 'Preferences mises a jour' });
      await loadData();
    } catch (err) {
      console.error('Failed to update member:', err);
      addToast({ type: 'error', message: 'Erreur lors de la modification' });
    }
  }, [addToast, loadData]);

  const handleToday = useCallback(() => {
    setYear(new Date().getFullYear());
    setScrollToTodayTrigger((n) => n + 1);
  }, []);

  const handleBack = useCallback(() => {
    if (onNavigate) onNavigate('/');
    else window.location.href = '/';
  }, [onNavigate]);

  return (
    <>
      <ModuleHeader title="Conges" onBack={handleBack}>
        <button className="module-header-btn" onClick={handleToday}>
          Aujourd&apos;hui
        </button>
        <ViewControls
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          year={year}
          onYearChange={handleYearChange}
        />
        <button className="module-header-btn" onClick={() => setShowMemberList(true)}>
          Equipe
        </button>
        <button className="module-header-btn module-header-btn-primary" onClick={handleAddLeave}>
          + Nouveau
        </button>
      </ModuleHeader>

      <div className="conges-page">
        <div className="conges-content">
          {loading && members.length === 0 ? (
            <div className="conges-loading">Chargement...</div>
          ) : members.length === 0 ? (
            <div className="conges-empty">
              <p>Aucun membre avec la permission &quot;conges&quot;</p>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                Les membres sont geres via les permissions gateway.
              </p>
            </div>
          ) : (
            <LeaveCalendar
              members={members}
              leaves={leaves}
              startDate={startDate}
              endDate={endDate}
              viewMode={viewMode}
              currentUserId={user?.id}
              onLeaveClick={handleLeaveClick}
              scrollToTodayTrigger={scrollToTodayTrigger}
            />
          )}
        </div>
      </div>

      {showLeaveForm && (
        <LeaveForm
          members={members}
          leave={editingLeave}
          currentUser={user ? { id: user.id, email: user.email, isAdmin: user.isAdmin } : null}
          onSubmit={handleLeaveSubmit}
          onDelete={editingLeave ? handleLeaveDelete : undefined}
          onClose={() => { setShowLeaveForm(false); setEditingLeave(null); }}
        />
      )}

      {showMemberList && (
        <MemberList
          members={members}
          onUpdate={handleUpdateMember}
          onClose={() => setShowMemberList(false)}
        />
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Supprimer le conge"
          message="Etes-vous sur de vouloir supprimer ce conge ?"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteConfirm(null)}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </>
  );
}
