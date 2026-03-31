import { useState, useMemo } from 'react';
import { Modal } from '@boilerplate/shared/components';
import type { Member, Leave, LeaveFormData } from '../../types';
import styles from './LeaveForm.module.css';

interface LeaveFormProps {
  members: Member[];
  leave?: Leave | null;
  currentUser: { id: number; email: string; isAdmin: boolean } | null;
  onSubmit: (data: LeaveFormData) => void;
  onDelete?: () => void;
  onClose: () => void;
}

// French public holidays for 2026
const FRENCH_HOLIDAYS_2026 = [
  '2026-01-01', // Jour de l'An
  '2026-04-06', // Lundi de Pâques
  '2026-04-09', // Jeudi saint (Alsace)
  '2026-05-01', // Fête du Travail
  '2026-05-14', // Ascension
  '2026-05-21', // Jeudi de l'Ascension
  '2026-05-24', // Lundi de Pentecôte
  '2026-07-14', // Fête nationale
  '2026-08-15', // Assomption
  '2026-11-01', // Toussaint
  '2026-11-11', // Armistice
  '2026-12-25', // Noël
];

const REASON_OPTIONS = [
  'Congé payé',
  'RTT',
  'Congé maladie',
  'Congé sans solde',
];

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isHoliday(date: Date): boolean {
  const dateStr = date.toISOString().split('T')[0];
  return FRENCH_HOLIDAYS_2026.includes(dateStr);
}

function getDateRangeWarnings(start: string, end: string): string[] {
  const warnings: string[] = [];
  if (!start) return warnings;

  const endDate = end || start;
  const current = new Date(start);
  const last = new Date(endDate);
  let hasWeekend = false;
  let hasHoliday = false;

  while (current <= last) {
    if (isWeekend(current)) hasWeekend = true;
    if (isHoliday(current)) hasHoliday = true;
    current.setDate(current.getDate() + 1);
  }

  if (hasWeekend) {
    warnings.push('La période sélectionnée inclut un ou plusieurs jours de week-end.');
  }
  if (hasHoliday) {
    warnings.push('La période sélectionnée inclut un ou plusieurs jours fériés.');
  }

  return warnings;
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
  const [reason, setReason] = useState(leave?.reason || REASON_OPTIONS[0]);

  const warnings = useMemo(() => getDateRangeWarnings(startDate, endDate), [startDate, endDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId || !startDate) return;
    onSubmit({
      memberId,
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
            onChange={(e) => setReason(e.target.value)}
          >
            {REASON_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {warnings.length > 0 && (
          <div className={styles.warnings}>
            {warnings.map((w, i) => (
              <div key={i} className={styles.warning}>{w}</div>
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
