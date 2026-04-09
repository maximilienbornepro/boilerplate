export interface Document {
  id: string;
  title: string;
  description?: string | null;
}

export interface Subject {
  id: string;           // UUID - primary identifier for all operations
  section_id: string;   // Parent section UUID
  title: string;
  situation: string | null;
  status: string;
  responsibility: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  // UI state (not persisted)
  isNew?: boolean;
  hasChanges?: boolean;
}

export interface Section {
  id: string;           // UUID - primary identifier for all operations
  document_id: string;
  name: string;
  position: number;
  subjects: Subject[];
  created_at: string;
  updated_at: string;
}

export interface DocumentWithSections {
  id: string;
  title: string;
  sections: Section[];
  updated_at: string;
}

export interface NewSubject {
  title: string;
  situation?: string;
  status?: string;
  responsibility?: string;
}

export interface Change {
  section: string;
  type: 'new' | 'modified' | 'status_change';
  subject: string;
  details: string;
}

export interface DiffChange {
  sectionName: string;
  subjectTitle: string;
  changeType: string;
  details: string;
  currentStatus?: string;
}

export interface SnapshotDiff {
  hasChanges: boolean;
  snapshotDate: string | null;
  changesCount: number;
  changes: DiffChange[];
}

export interface SnapshotInfo {
  id: number;
  type: string;
  created_at: string;
}

export type WizardStep = 'select' | 'review' | 'preview' | 'complete';

export interface StatusOption {
  value: string;
  label: string;
  color: string;
}

export const STATUS_OPTIONS: StatusOption[] = [
  { value: '🔴 à faire', label: 'À faire', color: '#ef4444' },
  { value: '🟡 en cours', label: 'En cours', color: '#f59e0b' },
  { value: '🔵 en analyse', label: 'En analyse', color: '#3b82f6' },
  { value: '🟢 terminé', label: 'Terminé', color: '#10b981' },
  { value: '🟣 bloqué', label: 'Bloqué', color: '#a855f7' },
  { value: '🚀 à MEP', label: 'À MEP', color: '#06b6d4' },
];

export function getStatusOption(value: string): StatusOption {
  return STATUS_OPTIONS.find(o => o.value === value) ?? STATUS_OPTIONS[0];
}
