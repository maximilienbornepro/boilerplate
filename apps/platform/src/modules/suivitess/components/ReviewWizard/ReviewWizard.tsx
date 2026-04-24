import { useState, useEffect, useRef, useCallback } from 'react';
import { ToastContainer, Card, Button, StatusTag } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import type { Section, Change, WizardStep, Subject, DocumentWithSections, SnapshotInfo } from '../../types';
import { getStatusOption } from '../../types';
import {
  fetchDocument,
  createSection,
  updateSection,
  deleteSection as apiDeleteSection,
  createSubject,
  updateSubject,
  deleteSubject as apiDeleteSubject,
  reorderSections,
  reorderSubjects,
  createSnapshot,
  getDocumentHistory,
  getSnapshot,
  getSnapshotDiff,
} from '../../services/api';
import { SubjectReview } from '../SubjectReview/SubjectReview';
import { Preview } from '../Preview/Preview';
import { TableOfContents } from '../TableOfContents/TableOfContents';
import styles from './ReviewWizard.module.css';

// Email table helpers - status colors with background and text
const STATUS_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  'à faire': { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  'en cours': { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
  'en analyse': { bg: '#f0f9ff', text: '#0284c7', border: '#bae6fd' },
  'terminé': { bg: '#f0fdf4', text: '#059669', border: '#bbf7d0' },
  'bloqué': { bg: '#faf5ff', text: '#7c3aed', border: '#ddd6fe' },
  'MEP': { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
};

const DEFAULT_STATUS_STYLE = { bg: '#f3f4f6', text: '#4b5563', border: '#d1d5db' };

function getStatusBadge(status: string): { label: string; bg: string; text: string; border: string } {
  const label = status.replace(/^[^\s]+\s/, '').trim();
  const key = Object.keys(STATUS_STYLES).find(k => status.toLowerCase().includes(k));
  const style = key ? STATUS_STYLES[key] : DEFAULT_STATUS_STYLE;
  return { label, ...style };
}

function getSubjectBulletContent(subject: Subject): string {
  return subject.situation || '';
}

function bulletTextToHtml(text: string): string {
  const BULLET_CHARS = '•◦▪▸';
  const indentRegex = /^([\s\u00A0]*)(.*)/;
  const lines = text.split('\n').filter(l => l.trim());

  const hasBullets = lines.some(l => BULLET_CHARS.includes(l.trim()[0]));
  let hasSeenSubHeader = false;

  const getIndent = (level: number) => '&nbsp;'.repeat(level * 3);

  const renderMarkdown = (str: string) => str
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<span style="text-decoration:line-through;color:#888;">$1</span>');

  return lines
    .map(line => {
      const m = line.match(indentRegex);
      if (!m) return '';

      const leadingSpaces = m[1].length;
      const content = m[2].trim();
      if (!content) return '';

      const startsWithBullet = BULLET_CHARS.includes(content[0]);

      if (hasBullets) {
        if (startsWithBullet) {
          let textWithoutBullet = content.replace(/^[•◦▪▸]\s*/, '');
          let level = Math.floor(leadingSpaces / 4);
          if (level === 0 && hasSeenSubHeader) level = 1;
          level = Math.min(level, 3);
          const bullets = ['•', '◦', '▪', '▸'];
          const indent = getIndent(level);

          return `<div style="line-height:1.8;">${indent}${bullets[level]} ${renderMarkdown(textWithoutBullet)}</div>`;
        } else {
          hasSeenSubHeader = true;
          return `<div style="margin-top:10px;margin-bottom:4px;line-height:1.8;font-weight:600;">${renderMarkdown(content)}</div>`;
        }
      } else {
        let level = Math.floor(leadingSpaces / 2);
        level = Math.min(level, 3);
        const indent = getIndent(level);
        const bullets = ['•', '◦', '▪', '▸'];

        return `<div style="line-height:1.8;">${indent}${bullets[level]} ${renderMarkdown(content)}</div>`;
      }
    })
    .join('');
}

interface ReviewWizardProps {
  docId?: string;
  onBack?: () => void;
  onCopyReady?: (copyFn: (() => void) | null) => void;
  onExportJsonReady?: (exportFn: (() => void) | null) => void;
  onSaveAllReady?: (saveFn: (() => Promise<void>) | null) => void;
  onUnsavedChange?: (hasUnsaved: boolean) => void;
  scrollToSectionId?: string;
}

export function ReviewWizard({ docId, onBack, onCopyReady, onExportJsonReady, onSaveAllReady, onUnsavedChange, scrollToSectionId }: ReviewWizardProps) {
  const [step, setStep] = useState<WizardStep>(docId ? 'review' : 'select');
  const [selectedDoc, setSelectedDoc] = useState<string>(docId || '');
  const [docTitle, setDocTitle] = useState<string>('');
  const [j5Date, setJ5Date] = useState<string | null>(null);
  const [snapshotChanges, setSnapshotChanges] = useState<{ added: { title: string; section: string }[]; removed: { title: string; section: string }[]; modified: { title: string; section: string; lastChange: string; status: string }[] }>({ added: [], removed: [], modified: [] });
  const [availableSnapshots, setAvailableSnapshots] = useState<SnapshotInfo[]>([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(new Set());
  const [collapsedSubjectIds, setCollapsedSubjectIds] = useState<Set<string>>(new Set());
  const [dragItem, setDragItem] = useState<{ type: 'section' | 'subject'; sectionIdx: number; subjectIdx?: number } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ type: 'section' | 'subject'; sectionIdx: number; subjectIdx?: number; position: 'before' | 'after' } | null>(null);
  const [addingInSection, setAddingInSection] = useState<string | null>(null);
  const [newSubjectTitle, setNewSubjectTitle] = useState('');
  const [summary, setSummary] = useState<string>('');
  const [finalContent, setFinalContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(!!docId);
  const [isUpdating, setIsUpdating] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [showNewSectionForm, setShowNewSectionForm] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [focusedItem, setFocusedItem] = useState<string | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState('');
  const reviewContentRef = useRef<HTMLDivElement>(null);

  // Stable ref for onBack to avoid useEffect re-runs
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  // Registry for per-subject save functions
  const saveRegistryRef = useRef<Map<string, () => Promise<void>>>(new Map());
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const registerSave = useCallback((id: string, saveFn: () => Promise<void>) => {
    saveRegistryRef.current.set(id, saveFn);
  }, []);

  const unregisterSave = useCallback((id: string) => {
    saveRegistryRef.current.delete(id);
  }, []);

  const reloadDocument = useCallback(async () => {
    if (!selectedDoc) return;
    const doc = await fetchDocument(selectedDoc);
    setSections(doc.sections);
  }, [selectedDoc]);

  const handleSaveAll = useCallback(async () => {
    const saveFns = Array.from(saveRegistryRef.current.values());
    if (saveFns.length === 0) return;
    setIsSavingAll(true);
    try {
      for (const saveFn of saveFns) {
        await saveFn();
      }

      if (selectedDoc) {
        const diff = await getSnapshotDiff(selectedDoc);
        await reloadDocument();
        await createSnapshot(selectedDoc);

        if (diff.hasChanges) {
          setJ5Date(new Date().toISOString());
          const added = diff.changes.filter(c => c.changeType === 'added').map(c => ({ title: c.subjectTitle, section: c.sectionName }));
          const removed = diff.changes.filter(c => c.changeType === 'removed').map(c => ({ title: c.subjectTitle, section: c.sectionName }));
          const modified = diff.changes.filter(c => c.changeType.includes('changed'))
            .map(c => ({ title: c.subjectTitle, section: c.sectionName, lastChange: c.details, status: c.currentStatus || '' }));
          setSnapshotChanges({ added, removed, modified });
        } else {
          setJ5Date(new Date().toISOString());
          setSnapshotChanges({ added: [], removed: [], modified: [] });
        }

        const snapshots = await getDocumentHistory(selectedDoc);
        setAvailableSnapshots(snapshots);
        if (snapshots.length > 0) {
          setSelectedSnapshotId(snapshots[0].id);
        }
      }

      setHasUnsavedChanges(false);
      onUnsavedChange?.(false);
      addToast({ type: 'success', message: `${saveFns.length} sujets sauvegardés` });
    } catch (error) {
      console.error('Save all failed:', error);
      addToast({ type: 'error', message: 'Erreur lors de la sauvegarde' });
    } finally {
      setIsSavingAll(false);
    }
  }, [selectedDoc, reloadDocument, onUnsavedChange]);

  const handleDirty = useCallback(() => {
    if (!hasUnsavedChanges) {
      setHasUnsavedChanges(true);
      onUnsavedChange?.(true);
    }
  }, [hasUnsavedChanges, onUnsavedChange]);

  const isSavingOthersRef = useRef(false);
  const handleAutoSaveComplete = useCallback(async () => {
    if (isSavingOthersRef.current) return;
    isSavingOthersRef.current = true;
    try {
      const saveFns = Array.from(saveRegistryRef.current.values());
      for (const saveFn of saveFns) {
        await saveFn();
      }
    } catch (error) {
      console.error('Save others failed:', error);
    } finally {
      isSavingOthersRef.current = false;
    }
  }, []);

  // Handle snapshot selection change
  const handleSnapshotChange = async (snapshotId: number) => {
    if (snapshotId === selectedSnapshotId) return;

    try {
      const snapshotData = await getSnapshot(snapshotId);
      setSelectedSnapshotId(snapshotId);
      setJ5Date(snapshotData.created_at);

      // Compare with snapshot data
      const snapshotDoc = snapshotData.data;
      const snapshotById = new Map<string, { subject: Subject; section: string }>();
      snapshotDoc.sections.forEach(s => {
        s.subjects.forEach(sub => snapshotById.set(sub.id, { subject: sub, section: s.name }));
      });

      const currentIds = new Set<string>();
      const added: { title: string; section: string }[] = [];
      const modified: { title: string; section: string; lastChange: string; status: string }[] = [];

      sections.forEach(section => {
        section.subjects.forEach(subject => {
          currentIds.add(subject.id);
          const snap = snapshotById.get(subject.id);
          if (!snap) {
            added.push({ title: subject.title, section: section.name });
            return;
          }
          if (snap.subject.status !== subject.status || snap.subject.situation !== subject.situation) {
            modified.push({ title: subject.title, section: section.name, lastChange: '', status: subject.status });
          }
        });
      });

      const removed: { title: string; section: string }[] = [];
      snapshotById.forEach(({ subject, section }, id) => {
        if (!currentIds.has(id)) {
          removed.push({ title: subject.title, section });
        }
      });

      setSnapshotChanges({ added, removed, modified });
    } catch (err) {
      console.error('Failed to load snapshot:', err);
      addToast({ type: 'error', message: 'Erreur lors du chargement du snapshot' });
    }
  };

  // Load document
  useEffect(() => {
    if (!docId) return;

    async function loadDocument() {
      setIsLoading(true);
      try {
        const doc = await fetchDocument(docId!);
        setSelectedDoc(docId!);
        setDocTitle(doc.title);
        setSections(doc.sections);

        const snapshots = await getDocumentHistory(docId!);
        setAvailableSnapshots(snapshots);
        if (snapshots.length > 0) {
          setSelectedSnapshotId(snapshots[0].id);
        }

        const diff = await getSnapshotDiff(docId!);
        if (diff.hasChanges) {
          setJ5Date(diff.snapshotDate);
          const added = diff.changes.filter(c => c.changeType === 'added').map(c => ({ title: c.subjectTitle, section: c.sectionName }));
          const removed = diff.changes.filter(c => c.changeType === 'removed').map(c => ({ title: c.subjectTitle, section: c.sectionName }));
          const modified = diff.changes.filter(c => c.changeType.includes('changed'))
            .map(c => ({ title: c.subjectTitle, section: c.sectionName, lastChange: c.details, status: c.currentStatus || '' }));
          setSnapshotChanges({ added, removed, modified });
        }

        setStep('review');
      } catch (err) {
        console.error('Failed to load document:', err);
        addToast({ type: 'error', message: 'Erreur lors du chargement du document' });
        onBackRef.current?.();
      } finally {
        setIsLoading(false);
      }
    }

    loadDocument();
  }, [docId]);

  // Scroll to section when coming from Roadmap with ?section= param.
  // Retry several times because the DOM may take time to render after data load.
  useEffect(() => {
    if (!scrollToSectionId || sections.length === 0) return;
    let attempts = 0;
    const tryScroll = () => {
      const el = document.querySelector(`[data-section-id="${scrollToSectionId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Highlight briefly
        (el as HTMLElement).style.transition = 'background-color 0.6s';
        (el as HTMLElement).style.backgroundColor = 'rgba(102, 126, 234, 0.15)';
        setTimeout(() => { (el as HTMLElement).style.backgroundColor = ''; }, 1500);
        return;
      }
      attempts++;
      if (attempts < 10) setTimeout(tryScroll, 200);
    };
    setTimeout(tryScroll, 100);
  }, [scrollToSectionId, sections]);

  const addToast = (toast: Omit<ToastData, 'id'>) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { ...toast, id }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const handleSubjectUpdate = (sectionIdx: number, subjectIdx: number, updatedSubject?: Subject) => {
    if (!updatedSubject?.hasChanges) return;

    const section = sections[sectionIdx];
    const originalSubject = section.subjects[subjectIdx];

    setChanges(prev => [...prev, {
      section: section.name,
      type: updatedSubject.status !== originalSubject.status ? 'status_change' : 'modified',
      subject: updatedSubject.title,
      details: updatedSubject.situation || `Statut: ${updatedSubject.status}`
    }]);

    const updatedSections = [...sections];
    updatedSections[sectionIdx].subjects[subjectIdx] = updatedSubject;
    setSections(updatedSections);
  };

  const handleSubjectSaved = (sectionIdx: number, subjectIdx: number, updatedSubject: Subject) => {
    setSections(prev => {
      const updated = [...prev];
      updated[sectionIdx] = {
        ...updated[sectionIdx],
        subjects: updated[sectionIdx].subjects.map((s, i) =>
          i === subjectIdx ? updatedSubject : s
        )
      };
      return updated;
    });
    addToast({ type: 'success', message: `"${updatedSubject.title}" sauvegardé` });
  };

  const handleDeleteSubject = async (sectionIdx: number, subjectIdx: number, subject: Subject) => {
    if (!confirm(`Supprimer le sujet "${subject.title}" ?`)) return;

    try {
      await apiDeleteSubject(subject.id);
      setSections(prev => {
        const updated = [...prev];
        updated[sectionIdx] = {
          ...updated[sectionIdx],
          subjects: updated[sectionIdx].subjects.filter((_, i) => i !== subjectIdx)
        };
        return updated;
      });
      addToast({ type: 'success', message: `"${subject.title}" supprimé` });
    } catch (error) {
      console.error('Failed to delete subject:', error);
      addToast({ type: 'error', message: 'Erreur lors de la suppression' });
    }
  };

  const handleAddNewSubject = async (title: string, sectionId: string) => {
    try {
      const newSubject = await createSubject(sectionId, {
        title,
        situation: '',
        status: '🔴 à faire',
        responsibility: ''
      });

      setSections(prev => prev.map(section =>
        section.id === sectionId
          ? { ...section, subjects: [...section.subjects, { ...newSubject, isNew: true }] }
          : section
      ));

      setHasUnsavedChanges(true);
      onUnsavedChange?.(true);
      addToast({ type: 'success', message: `"${title}" ajouté` });
    } catch (error) {
      console.error('Failed to add subject:', error);
      addToast({ type: 'error', message: 'Erreur lors de l\'ajout du sujet' });
    }
  };

  // Reorder subjects within a section
  const handleReorderSubject = useCallback(async (sectionIdx: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;

    const section = sections[sectionIdx];
    const newSubjects = [...section.subjects];
    const [moved] = newSubjects.splice(fromIdx, 1);
    newSubjects.splice(toIdx, 0, moved);

    setSections(prev => prev.map((s, i) =>
      i === sectionIdx ? { ...s, subjects: newSubjects } : s
    ));

    try {
      await reorderSubjects(section.id, newSubjects.map(s => s.id));
      addToast({ type: 'success', message: 'Sujet déplacé' });
    } catch (error) {
      console.error('Failed to reorder subjects:', error);
      addToast({ type: 'error', message: 'Erreur lors du déplacement' });
      await reloadDocument();
    }
  }, [sections, reloadDocument]);

  // Reorder sections
  const handleReorderSection = useCallback(async (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;

    const newSections = [...sections];
    const [moved] = newSections.splice(fromIdx, 1);
    newSections.splice(toIdx, 0, moved);

    setSections(newSections);

    try {
      await reorderSections(selectedDoc, newSections.map(s => s.id));
      addToast({ type: 'success', message: 'Section déplacée' });
    } catch (error) {
      console.error('Failed to reorder sections:', error);
      addToast({ type: 'error', message: 'Erreur lors du déplacement' });
      await reloadDocument();
    }
  }, [sections, selectedDoc, reloadDocument]);

  // Move subject to a different section
  const handleReorderSubjectCrossSection = useCallback(async (
    fromSectionIdx: number, fromSubjectIdx: number,
    toSectionIdx: number, toSubjectIdx: number
  ) => {
    const subject = sections[fromSectionIdx]?.subjects[fromSubjectIdx];
    const targetSection = sections[toSectionIdx];
    if (!subject || !targetSection) return;

    try {
      await updateSubject(subject.id, {
        sectionId: targetSection.id,
        position: toSubjectIdx
      });
      await reloadDocument();
      addToast({ type: 'success', message: 'Sujet déplacé vers ' + targetSection.name });
    } catch (error) {
      console.error('Failed to move subject cross-section:', error);
      addToast({ type: 'error', message: 'Erreur lors du déplacement' });
      await reloadDocument();
    }
  }, [sections, reloadDocument]);

  const handleAddSection = async () => {
    if (!newSectionName.trim()) return;

    try {
      const newSection = await createSection(selectedDoc, newSectionName.trim());

      const firstSubject = await createSubject(newSection.id, {
        title: 'Premier sujet',
        situation: 'À compléter',
        status: '🟡 en cours',
        responsibility: '@Responsable'
      });

      setSections(prev => [...prev, { ...newSection, subjects: [firstSubject] }]);
      setShowNewSectionForm(false);
      setNewSectionName('');

      setHasUnsavedChanges(true);
      onUnsavedChange?.(true);
      addToast({ type: 'success', message: `Section "${newSectionName.trim()}" créée` });
    } catch (error) {
      console.error('Failed to add section:', error);
      addToast({ type: 'error', message: 'Erreur lors de la création de la section' });
    }
  };

  const handleRenameSection = async (sectionId: string, newName: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section || !newName.trim() || newName.trim() === section.name) return;

    try {
      await updateSection(sectionId, { name: newName.trim() });
      setSections(prev => prev.map(s =>
        s.id === sectionId ? { ...s, name: newName.trim() } : s
      ));
      addToast({ type: 'success', message: `Section renommée: "${newName.trim()}"` });
    } catch (error) {
      console.error('Failed to rename section:', error);
      addToast({ type: 'error', message: 'Erreur lors du renommage' });
    }
  };

  const handleDeleteSection = async (sectionId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;
    if (!confirm(`Supprimer la section "${section.name}" et ses ${section.subjects.length} sujet(s) ?\n\nCette action est irréversible.`)) return;

    try {
      await apiDeleteSection(sectionId);
      setSections(prev => prev.filter(s => s.id !== sectionId));
      addToast({ type: 'success', message: `Section "${section.name}" supprimée` });
    } catch (error) {
      console.error('Failed to delete section:', error);
      addToast({ type: 'error', message: 'Erreur lors de la suppression' });
    }
  };

  const generatePreview = async () => {
    setIsLoading(true);
    try {
      if (changes.length > 0) {
        // Generate a simple text summary of changes
        const lines = changes.map(c => `- [${c.section}] ${c.subject}: ${c.type === 'new' ? 'Nouveau' : c.type === 'status_change' ? 'Changement de statut' : 'Modifié'}`);
        setSummary(lines.join('\n'));
      } else {
        setSummary('*Aucune modification - Document vérifié*');
      }
      setFinalContent('');
      setStep('preview');
    } catch (err) {
      console.error('Failed to generate preview:', err);
      addToast({ type: 'error', message: 'Erreur lors de la génération de la preview' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      await createSnapshot(selectedDoc);
      setStep('complete');
    } catch (err) {
      console.error('Failed to update:', err);
      addToast({ type: 'error', message: 'Erreur lors de la mise à jour du document' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReset = () => {
    if (onBack) {
      onBack();
    } else {
      setStep('select');
      setSelectedDoc('');
      setDocTitle('');
      setJ5Date(null);
      setSnapshotChanges({ added: [], removed: [], modified: [] });
      setSections([]);
      setChanges([]);
      setAddingInSection(null);
      setNewSubjectTitle('');
      setSummary('');
      setFinalContent('');
    }
  };

  const handleCopyTable = useCallback(() => {
    const cs = 'border:1px dashed #9ca3af;padding:12px 16px;vertical-align:top;';

    let html = '<div style="font-family:Arial,Helvetica,sans-serif;background:#1a1a2e;border:1px dashed #9ca3af;border-radius:12px;padding:20px;max-width:900px;width:100%;box-sizing:border-box;">';

    const hasChanges = snapshotChanges.added.length > 0 || snapshotChanges.removed.length > 0 || snapshotChanges.modified.length > 0;
    if (hasChanges && j5Date) {
      html += '<div style="background:#252542;border-radius:8px;padding:14px;margin-bottom:16px;">';
      html += `<div style="font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px;">Changements depuis la dernière sauvegarde du ${new Date(j5Date).toLocaleDateString('fr-FR')}</div>`;

      if (snapshotChanges.added.length > 0) {
        html += '<div style="margin-bottom:6px;">';
        html += `<span style="display:inline-block;background:rgba(5,150,105,0.25);color:#10b981;font-size:11px;font-weight:600;padding:3px 10px;border-radius:4px;margin-bottom:6px;">+${snapshotChanges.added.length} nouveau(x)</span>`;
        snapshotChanges.added.forEach(a => {
          html += `<div style="font-size:12px;color:#d1d5db;margin-left:4px;margin-top:4px;"><span style="color:#888;">[${a.section}]</span> ${a.title}</div>`;
        });
        html += '</div>';
      }

      if (snapshotChanges.removed.length > 0) {
        html += '<div style="margin-bottom:6px;">';
        html += `<span style="display:inline-block;background:rgba(220,38,38,0.25);color:#f87171;font-size:11px;font-weight:600;padding:3px 10px;border-radius:4px;margin-bottom:6px;">-${snapshotChanges.removed.length} supprimé(s)</span>`;
        snapshotChanges.removed.forEach(r => {
          html += `<div style="font-size:12px;color:#d1d5db;margin-left:4px;margin-top:4px;"><span style="color:#888;">[${r.section}]</span> ${r.title}</div>`;
        });
        html += '</div>';
      }

      if (snapshotChanges.modified.length > 0) {
        html += '<div>';
        html += `<span style="display:inline-block;background:rgba(245,158,11,0.25);color:#fbbf24;font-size:11px;font-weight:600;padding:3px 10px;border-radius:4px;margin-bottom:6px;">${snapshotChanges.modified.length} modifié(s)</span>`;
        snapshotChanges.modified.forEach(m => {
          html += `<div style="font-size:12px;color:#d1d5db;margin-left:4px;margin-top:4px;"><span style="color:#888;">[${m.section}]</span> ${m.title}${m.lastChange ? `<span style="color:#9ca3af;font-style:italic;"> — ${m.lastChange}</span>` : ''}${m.status ? ` - ${m.status}` : ''}</div>`;
        });
        html += '</div>';
      }

      html += '</div>';
    }

    html += '<div style="background:#252542;border-radius:8px;padding:14px;box-sizing:border-box;max-width:100%;">';
    html += '<table style="border-collapse:collapse;width:100%;max-width:100%;font-size:13px;table-layout:fixed;">';

    for (const section of sections) {
      const totalRows = section.subjects.length;
      if (totalRows === 0) continue;

      for (let i = 0; i < section.subjects.length; i++) {
        const subject = section.subjects[i];
        const bulletContent = getSubjectBulletContent(subject);
        const { label: statusLabel, bg: statusBg, text: statusText, border: statusBorder } = getStatusBadge(subject.status);
        const rowBg = i % 2 === 0 ? '#2d2d4a' : '#252542';

        html += `<tr style="background:${rowBg};">`;

        if (i === 0) {
          html += `<td style="${cs}color:#ccc;font-size:12px;width:12%;" rowspan="${totalRows}">${section.name}</td>`;
        }

        html += `<td style="${cs}color:#eee;line-height:1.6;${i === 0 ? 'width:63%;' : ''}">`;
        html += `<strong style="font-size:14px;">${subject.title}</strong><br><br>`;
        html += `<strong>État de la situation :</strong><br>`;
        html += bulletTextToHtml(bulletContent);
        html += `</td>`;

        html += `<td style="${cs}text-align:center;vertical-align:middle;${i === 0 ? 'width:12%;' : ''}">`;
        html += `<span style="display:inline-block;background:${statusBg};color:${statusText};border:1px solid ${statusBorder};padding:6px 12px;border-radius:6px;font-weight:600;font-size:11px;white-space:nowrap;">${statusLabel}</span>`;
        html += `</td>`;

        html += `<td style="${cs}color:#ccc;vertical-align:middle;font-size:11px;${i === 0 ? 'width:13%;' : ''}">${subject.responsibility || ''}</td>`;
        html += `</tr>`;
      }
    }

    html += '</table></div></div>';

    try {
      const htmlBlob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([html], { type: 'text/plain' });
      navigator.clipboard.write([new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob
      })]).then(() => {
        addToast({ type: 'success', message: 'Tableau copié ! Collez-le dans votre email.' });
      }).catch(() => {
        copyWithFallback(html);
      });
    } catch {
      copyWithFallback(html);
    }

    function copyWithFallback(content: string) {
      const div = document.createElement('div');
      div.innerHTML = content;
      div.style.position = 'fixed';
      div.style.left = '-9999px';
      document.body.appendChild(div);
      const range = document.createRange();
      range.selectNodeContents(div);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand('copy');
      selection?.removeAllRanges();
      document.body.removeChild(div);
      addToast({ type: 'success', message: 'Tableau copié ! Collez-le dans votre email.' });
    }
  }, [sections, snapshotChanges, j5Date]);

  useEffect(() => {
    if (onCopyReady && sections.length > 0) {
      onCopyReady(handleCopyTable);
    }
    return () => {
      if (onCopyReady) onCopyReady(null);
    };
  }, [sections.length, onCopyReady, handleCopyTable]);

  const handleExportJson = useCallback(() => {
    // Filter out strikethrough lines (~~text~~) from situation text
    const cleanSituation = (text: string | null): string | null => {
      if (!text) return text;
      const lines = text.split('\n').filter(line => {
        const trimmed = line.replace(/^[\s>]*/, '');
        return !trimmed.startsWith('~~');
      });
      return lines.length > 0 ? lines.join('\n') : null;
    };

    const exportData = {
      exportedAt: new Date().toISOString(),
      document: docTitle,
      sections: sections.map(section => ({
        name: section.name,
        subjects: section.subjects.map(subject => ({
          title: subject.title,
          situation: cleanSituation(subject.situation),
          status: subject.status,
          responsibility: subject.responsibility,
        })),
      })),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (docTitle || 'suivitess').replace(/[^a-zA-Z0-9_\-]/g, '_');
    a.href = url;
    a.download = `${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast({ type: 'success', message: 'Export JSON téléchargé.' });
  }, [sections, docTitle]);

  useEffect(() => {
    if (onExportJsonReady && sections.length > 0) {
      onExportJsonReady(handleExportJson);
    }
    return () => {
      if (onExportJsonReady) onExportJsonReady(null);
    };
  }, [sections.length, onExportJsonReady, handleExportJson]);

  useEffect(() => {
    if (onSaveAllReady && sections.length > 0) {
      onSaveAllReady(handleSaveAll);
    }
    return () => {
      if (onSaveAllReady) onSaveAllReady(null);
    };
  }, [sections.length, onSaveAllReady, handleSaveAll]);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Chargement en cours...</p>
        <ToastContainer toasts={toasts} onClose={removeToast} />
      </div>
    );
  }

  return (
    <div className={styles.wizard}>
      {step === 'review' && (
        <>
          <div className={styles.header}>
            <h1>{docTitle}</h1>
          </div>

          <div className={styles.reviewLayout}>
            <div className={styles.reviewContent} ref={reviewContentRef}>
              {sections.length === 0 && !showNewSectionForm && (
                <Card className={styles.emptyCard}>
                  <div className={styles.emptyContent}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                    <p className={styles.emptyTitle}>Aucune section</p>
                    <p className={styles.emptyHint}>Créer votre première section pour organiser vos sujets</p>
                    <Button variant="primary" onClick={() => setShowNewSectionForm(true)}>
                      + Nouvelle section
                    </Button>
                  </div>
                </Card>
              )}
              {sections.map((section, sIdx) => {
                const isSectionCollapsed = collapsedSectionIds.has(section.id);
                return (
                <div
                  key={section.id}
                  className={styles.sectionBlock}
                  data-section-id={section.id}
                  draggable={isSectionCollapsed}
                  onDragStart={isSectionCollapsed ? (e) => {
                    setDragItem({ type: 'section', sectionIdx: sIdx });
                    e.dataTransfer.effectAllowed = 'move';
                    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '0.4';
                  } : undefined}
                  onDragEnd={(e) => {
                    if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1';
                    if (dragItem?.type === 'section' && dropIndicator?.type === 'section') {
                      let toIdx = dropIndicator.sectionIdx;
                      if (dropIndicator.position === 'after') toIdx += 1;
                      if (toIdx > dragItem.sectionIdx) toIdx -= 1;
                      if (toIdx !== dragItem.sectionIdx) handleReorderSection(dragItem.sectionIdx, toIdx);
                    }
                    setDragItem(null);
                    setDropIndicator(null);
                  }}
                  onDragOver={isSectionCollapsed ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (!dragItem || dragItem.type !== 'section') return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                    setDropIndicator({ type: 'section', sectionIdx: sIdx, position });
                  } : undefined}
                  onDragLeave={isSectionCollapsed ? () => setDropIndicator(null) : undefined}
                  onDrop={isSectionCollapsed ? (e) => { e.preventDefault(); } : undefined}
                >
                  {dropIndicator?.type === 'section' && dropIndicator.sectionIdx === sIdx && dropIndicator.position === 'before' && (
                    <div className={styles.dropLine} />
                  )}
                  <div className={`${styles.sectionHeader} ${isSectionCollapsed ? styles.draggable : ''}`}>
                    <button
                      type="button"
                      className={styles.collapseBtn}
                      onClick={() => {
                        setCollapsedSectionIds(prev => {
                          const next = new Set(prev);
                          if (next.has(section.id)) next.delete(section.id);
                          else next.add(section.id);
                          return next;
                        });
                      }}
                      title={isSectionCollapsed ? 'Déplier la section' : 'Replier la section'}
                      aria-expanded={!isSectionCollapsed}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ transform: isSectionCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </button>
                    {editingSectionId === section.id ? (
                      <input
                        type="text"
                        className={styles.sectionNameInput}
                        value={editingSectionName}
                        onChange={(e) => setEditingSectionName(e.target.value)}
                        onBlur={() => {
                          handleRenameSection(section.id, editingSectionName);
                          setEditingSectionId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            handleRenameSection(section.id, editingSectionName);
                            setEditingSectionId(null);
                          } else if (e.key === 'Escape') {
                            setEditingSectionId(null);
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <h2
                        className={styles.sectionName}
                        onClick={() => {
                          setEditingSectionId(section.id);
                          setEditingSectionName(section.name);
                        }}
                        title="Cliquer pour renommer"
                      >
                        {section.name}
                      </h2>
                    )}
                    <span className={styles.sectionCount}>{section.subjects.length} sujet(s)</span>
                    <button
                      className="shared-card__delete-btn"
                      onClick={() => handleDeleteSection(section.id)}
                      title="Supprimer cette section"
                      style={{ opacity: 1 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>

                  {!isSectionCollapsed && section.subjects.map((subject, subIdx) => {
                    const isSubjectCollapsed = collapsedSubjectIds.has(subject.id);
                    return (
                    <div
                      key={subject.id}
                      data-subject-id={`subject-${sIdx}-${subIdx}`}
                      className={`${styles.subjectItem} ${isSubjectCollapsed ? styles.subjectItemCollapsed : ''}`}
                      draggable={isSubjectCollapsed}
                      onDragStart={isSubjectCollapsed ? (e) => {
                        setDragItem({ type: 'subject', sectionIdx: sIdx, subjectIdx: subIdx });
                        e.dataTransfer.effectAllowed = 'move';
                        if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '0.4';
                      } : undefined}
                      onDragEnd={(e) => {
                        if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1';
                        if (dragItem && dropIndicator && dropIndicator.type === 'subject' && dropIndicator.subjectIdx !== undefined) {
                          let toIdx = dropIndicator.subjectIdx;
                          if (dropIndicator.position === 'after') toIdx += 1;
                          if (dragItem.sectionIdx === dropIndicator.sectionIdx) {
                            if (toIdx > (dragItem.subjectIdx ?? 0)) toIdx -= 1;
                            if (toIdx !== dragItem.subjectIdx) handleReorderSubject(dragItem.sectionIdx, dragItem.subjectIdx!, toIdx);
                          } else {
                            handleReorderSubjectCrossSection(dragItem.sectionIdx, dragItem.subjectIdx!, dropIndicator.sectionIdx, toIdx);
                          }
                        }
                        setDragItem(null);
                        setDropIndicator(null);
                      }}
                      onDragOver={isSubjectCollapsed ? (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (!dragItem || dragItem.type !== 'subject') return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                        setDropIndicator({ type: 'subject', sectionIdx: sIdx, subjectIdx: subIdx, position });
                      } : undefined}
                      onDragLeave={isSubjectCollapsed ? () => setDropIndicator(null) : undefined}
                      onDrop={isSubjectCollapsed ? (e) => { e.preventDefault(); } : undefined}
                    >
                      {dropIndicator?.type === 'subject' && dropIndicator.sectionIdx === sIdx && dropIndicator.subjectIdx === subIdx && dropIndicator.position === 'before' && (
                        <div className={styles.dropLine} />
                      )}
                      {isSubjectCollapsed ? (
                        <div className={`${styles.subjectCollapsed} ${isSubjectCollapsed ? styles.draggable : ''}`}>
                          <button
                            type="button"
                            className={styles.subjectCollapsedToggle}
                            onClick={() => {
                              setCollapsedSubjectIds(prev => {
                                const next = new Set(prev);
                                next.delete(subject.id);
                                return next;
                              });
                            }}
                            title="Déplier le sujet"
                            aria-expanded="false"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(-90deg)' }}>
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </button>
                          <span className={styles.subjectCollapsedTitle}>{subject.title || 'Sans titre'}</span>
                          <span className={styles.subjectCollapsedStatus}>
                            <StatusTag label={getStatusOption(subject.status).label} color={getStatusOption(subject.status).color} />
                          </span>
                        </div>
                      ) : (
                        <SubjectReview
                          compact
                          subject={subject}
                          sectionName={section.name}
                          documentId={selectedDoc}
                          onNext={(updated) => handleSubjectUpdate(sIdx, subIdx, updated)}
                          onSaved={(updated) => handleSubjectSaved(sIdx, subIdx, updated)}
                          onDelete={() => handleDeleteSubject(sIdx, subIdx, subject)}
                          onFocus={() => setFocusedItem(`subject-${sIdx}-${subIdx}`)}
                          registerSave={registerSave}
                          unregisterSave={unregisterSave}
                          onAutoSaveComplete={handleAutoSaveComplete}
                          onDirty={handleDirty}
                          onToggleCollapse={() => {
                            setCollapsedSubjectIds(prev => {
                              const next = new Set(prev);
                              next.add(subject.id);
                              return next;
                            });
                          }}
                        />
                      )}
                      {dropIndicator?.type === 'subject' && dropIndicator.sectionIdx === sIdx && dropIndicator.subjectIdx === subIdx && dropIndicator.position === 'after' && (
                        <div className={styles.dropLine} />
                      )}
                    </div>
                    );
                  })}

                  {!isSectionCollapsed && (addingInSection === section.id ? (
                    <div className={styles.addSubjectInline}>
                      <input
                        type="text"
                        className={styles.addSubjectInput}
                        placeholder="Titre du nouveau sujet..."
                        value={newSubjectTitle}
                        onChange={(e) => setNewSubjectTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && newSubjectTitle.trim()) {
                            handleAddNewSubject(newSubjectTitle.trim(), section.id);
                            setNewSubjectTitle('');
                            setAddingInSection(null);
                          } else if (e.key === 'Escape') {
                            setNewSubjectTitle('');
                            setAddingInSection(null);
                          }
                        }}
                        autoFocus
                      />
                      <button
                        className={styles.addSubjectConfirm}
                        onClick={() => {
                          if (newSubjectTitle.trim()) {
                            handleAddNewSubject(newSubjectTitle.trim(), section.id);
                            setNewSubjectTitle('');
                            setAddingInSection(null);
                          }
                        }}
                        disabled={!newSubjectTitle.trim()}
                      >
                        Ajouter
                      </button>
                      <button
                        className={styles.addSubjectCancel}
                        onClick={() => {
                          setNewSubjectTitle('');
                          setAddingInSection(null);
                        }}
                      >
                        Annuler
                      </button>
                    </div>
                  ) : (
                    <button
                      className={styles.addSubjectBtn}
                      onClick={() => setAddingInSection(section.id)}
                    >
                      + Nouveau sujet
                    </button>
                  ))}
                  {dropIndicator?.type === 'section' && dropIndicator.sectionIdx === sIdx && dropIndicator.position === 'after' && (
                    <div className={styles.dropLine} />
                  )}
                </div>
                );
              })}

              {showNewSectionForm ? (
                <div className={styles.newSectionForm}>
                  <input
                    type="text"
                    className={styles.newSectionInput}
                    placeholder="Nom de la section (ex: Technique, Marketing...)"
                    value={newSectionName}
                    onChange={(e) => setNewSectionName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddSection()}
                    autoFocus
                  />
                  <div className={styles.newSectionActions}>
                    <button
                      className={styles.cancelSectionBtn}
                      onClick={() => {
                        setShowNewSectionForm(false);
                        setNewSectionName('');
                      }}
                    >
                      Annuler
                    </button>
                    <button
                      className={styles.createSectionBtn}
                      onClick={handleAddSection}
                      disabled={!newSectionName.trim()}
                    >
                      Créer la section
                    </button>
                  </div>
                </div>
              ) : sections.length > 0 ? (
                <button
                  className={styles.addSectionBtn}
                  onClick={() => setShowNewSectionForm(true)}
                >
                  + Nouvelle section
                </button>
              ) : null}
            </div>

            <TableOfContents
              sections={sections}
              containerRef={reviewContentRef}
              focusedItem={focusedItem}
              onReorderSubject={handleReorderSubject}
              onReorderSection={handleReorderSection}
              onReorderSubjectToSection={handleReorderSubjectCrossSection}
            />
          </div>
        </>
      )}

      {step === 'preview' && (
        <>
          <div className={styles.header}>
            <h1>{docTitle}</h1>
            <div className={styles.headerActions}>
              <button className={styles.resetBtn} onClick={handleReset}>
                Annuler
              </button>
            </div>
          </div>
          <Preview
            changes={changes}
            summary={summary}
            finalContent={finalContent}
            isUpdating={isUpdating}
            onUpdate={handleUpdate}
            onBack={() => setStep('review')}
          />
        </>
      )}

      {step === 'complete' && (
        <div className={styles.complete}>
          <div className={styles.completeIcon}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <h2 className={styles.completeTitle}>Document mis à jour</h2>
          <p className={styles.completeText}>
            Le document "{docTitle}" a été mis à jour.
          </p>
          {changes.length > 0 && (
            <p className={styles.completeChanges}>
              {changes.length} modification{changes.length > 1 ? 's' : ''} appliquée{changes.length > 1 ? 's' : ''}
            </p>
          )}
          <Button variant="primary" onClick={handleReset}>
            Nouvelle révision
          </Button>
        </div>
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </div>
  );
}
