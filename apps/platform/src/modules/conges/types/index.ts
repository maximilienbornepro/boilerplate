export type ViewMode = 'month' | 'quarter' | 'year';

export type LeaveReason = 'cp' | 'rtt' | 'maladie' | 'sans_solde';

export interface LeaveReasonInfo {
  id: LeaveReason;
  label: string;
  color: string;
}

export const LEAVE_REASONS: LeaveReasonInfo[] = [
  { id: 'cp', label: 'Congé payé', color: '#10b981' },
  { id: 'rtt', label: 'RTT', color: '#3b82f6' },
  { id: 'maladie', label: 'Maladie', color: '#ef4444' },
  { id: 'sans_solde', label: 'Sans solde', color: '#a855f7' },
];

export function getLeaveReasonInfo(id: string | null): LeaveReasonInfo {
  return LEAVE_REASONS.find((r) => r.id === id) ?? LEAVE_REASONS[0];
}

export interface Member {
  id: number;
  email: string;
  color: string;
  sortOrder: number;
}

export interface Leave {
  id: string;
  memberId: number;
  startDate: string;
  endDate: string;
  startPeriod: 'full' | 'morning' | 'afternoon';
  endPeriod: 'full' | 'morning' | 'afternoon';
  reason: LeaveReason;
  status: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type LeaveFormData = {
  memberId: number;
  startDate: string;
  endDate: string;
  startPeriod: 'full' | 'morning' | 'afternoon';
  endPeriod: 'full' | 'morning' | 'afternoon';
  reason: LeaveReason;
};
