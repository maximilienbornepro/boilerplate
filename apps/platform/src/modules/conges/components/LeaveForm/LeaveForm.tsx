import { useState, useMemo, useEffect } from 'react';
import { Modal, ModalBody, ModalActions, FormField, Button } from '@boilerplate/shared/components';
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
  const [startDateTouched, setStartDateTouched] = useState(!!leave);
  const [endDateTouched, setEndDateTouched] = useState(!!leave);
  const [periodTouched, setPeriodTouched] = useState(!!leave);
  const [reasonTouched, setReasonTouched] = useState(!!leave);

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
    <Modal title={isEdit ? 'Modifier le congé' : 'Poser un congé'} onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className={styles.form}>
        <ModalBody>
        {isAdmin && (
          <FormField label="Membre" required>
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
          </FormField>
        )}

        <div className={styles.row}>
          <FormField label="Date de début" required>
            <input
              type="date"
              className={styles.input}
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setStartDateTouched(true); }}
              onBlur={() => setStartDateTouched(true)}
              style={startDateTouched ? { color: 'var(--text-primary)' } : undefined}
              required
            />
          </FormField>
          <FormField label="Date de fin">
            <input
              type="date"
              className={styles.input}
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setEndDateTouched(true); }}
              onBlur={() => setEndDateTouched(true)}
              placeholder="Même jour"
              min={startDate || undefined}
              style={endDateTouched ? { color: 'var(--text-primary)' } : undefined}
            />
          </FormField>
        </div>

        <FormField label="Période">
          <select
            className={styles.select}
            value={period}
            onChange={(e) => { setPeriod(e.target.value as 'full' | 'morning' | 'afternoon'); setPeriodTouched(true); }}
            style={periodTouched ? { color: 'var(--text-primary)' } : undefined}
          >
            <option value="full">Journée complète</option>
            <option value="morning">Matin</option>
            <option value="afternoon">Après-midi</option>
          </select>
        </FormField>

        <FormField label="Motif">
          <select
            className={styles.select}
            value={reason}
            onChange={(e) => { setReason(e.target.value as LeaveReason); setReasonTouched(true); }}
            style={reasonTouched ? { color: 'var(--text-primary)' } : undefined}
          >
            {LEAVE_REASONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </FormField>

        {warnings.length > 0 && (
          <div className={styles.warnings}>
            {warnings.map((w, i) => (
              <div key={i} className={styles.warning}>⚠ {w}</div>
            ))}
          </div>
        )}

        </ModalBody>
        <ModalActions>
          {isEdit && onDelete && (
            <Button variant="danger" type="button" onClick={onDelete}>
              Supprimer
            </Button>
          )}
          <Button variant="secondary" type="button" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" type="submit">
            {isEdit ? 'Modifier' : 'Ajouter'}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
