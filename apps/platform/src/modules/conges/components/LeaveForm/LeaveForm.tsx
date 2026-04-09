import { useState, useMemo, useEffect } from 'react';
import { Modal } from '@boilerplate/shared/components';
import type { Member, Leave, LeaveFormData, LeaveReason } from '../../types';
import { LEAVE_REASONS } from '../../types';
import { getDateRangeWarnings } from '../../utils/holidays';
import styles from './LeaveForm.module.css';

interface LeaveFormProps {
  members: Member[];
  leave?: Leave | null;
  currentUser: { id: number; email: string; isAdmin: boolean } | null;
  onSubmit: (data: LeaveFormData) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function LeaveForm({ members, leave, currentUser, onSubmit, onDelete, onClose }: LeaveFormProps) {
  const isAdmin = currentUser?.isAdmin ?? false;

  const [memberId, setMemberId] = useState<number>(leave?.memberId ?? currentUser?.id ?? members[0]?.id ?? 0);
  const [startDate, setStartDate] = useState(leave?.startDate || '');
  const [endDate, setEndDate] = useState(leave?.endDate || '');
  const [period, setPeriod] = useState<'full' | 'morning' | 'afternoon'>(() => {
    if (leave) return leave.startPeriod || 'full';
    return 'full';
  });
  const [reason, setReason] = useState<LeaveReason>(leave?.reason || 'cp');

  // Fix: ensure memberId always matches currentUser for non-admins
  useEffect(() => {
    if (!isAdmin && currentUser?.id) {
      setMemberId(currentUser.id);
    }
  }, [currentUser?.id, isAdmin]);

  const warnings = useMemo(() => getDateRangeWarnings(startDate, endDate), [startDate, endDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveMemberId = isAdmin ? memberId : (currentUser?.id ?? memberId);
    if (!effectiveMemberId || !startDate) return;
    onSubmit({
      memberId: effectiveMemberId,
      startDate,
      endDate: endDate || startDate,
      startPeriod: period,
      endPeriod: period,
      reason,
    });
  };

  const isEdit = !!leave;

  return (
    <Modal title={isEdit ? 'Modifier le congé' : 'Poser un congé'} onClose={onClose} maxWidth={480}>
      <form onSubmit={handleSubmit} className={styles.form}>
        {isAdmin && (
          <div className={styles.field}>
            <label className={styles.label}>Membre</label>
            <select
              className={styles.select}
              value={memberId}
              onChange={(e) => setMemberId(Number(e.target.value))}
              required
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.email}</option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label}>Date de début</label>
            <input
              type="date"
              className={styles.input}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Date de fin</label>
            <input
              type="date"
              className={styles.input}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="Même jour"
              min={startDate || undefined}
            />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Période</label>
          <select
            className={styles.select}
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'full' | 'morning' | 'afternoon')}
          >
            <option value="full">Journée complète</option>
            <option value="morning">Matin</option>
            <option value="afternoon">Après-midi</option>
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Motif</label>
          <select
            className={styles.select}
            value={reason}
            onChange={(e) => setReason(e.target.value as LeaveReason)}
          >
            {LEAVE_REASONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>

        {warnings.length > 0 && (
          <div className={styles.warnings}>
            {warnings.map((w, i) => (
              <div key={i} className={styles.warning}>⚠ {w}</div>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          {isEdit && onDelete && (
            <button type="button" className={styles.deleteBtn} onClick={onDelete}>
              Supprimer
            </button>
          )}
          <div className={styles.rightActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Annuler
            </button>
            <button type="submit" className={styles.submitBtn}>
              {isEdit ? 'Modifier' : 'Ajouter'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
