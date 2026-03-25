export type ViewMode = 'month' | 'quarter' | 'year';

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
  reason: string | null;
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
  reason: string;
};
