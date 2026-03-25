import { useState, useRef, useEffect, useCallback } from 'react';
import type { Subject } from '../../types';
import { STATUS_OPTIONS } from '../../types';
import { updateSubject } from '../../services/api';
import styles from './SubjectReview.module.css';

interface Props {
  subject: Subject;
  sectionName: string;
  documentId: string;
  compact?: boolean;
  subjectIndex?: number;
  totalSubjects?: number;
  sectionIndex?: number;
  totalSections?: number;
  onNext: (updatedSubject?: Subject) => void;
  onSaved?: (updatedSubject: Subject) => void;
  onDelete?: () => void;
  onBack?: () => void;
  canGoBack?: boolean;
  onFocus?: () => void;
  registerSave?: (id: string, saveFn: () => Promise<void>) => void;
  unregisterSave?: (id: string) => void;
  onAutoSaveComplete?: () => void;
  onDirty?: () => void;
}

export function SubjectReview({
  subject,
  sectionName,
  documentId,
  compact = false,
  subjectIndex = 0,
  totalSubjects = 1,
  sectionIndex = 0,
  totalSections = 1,
  onNext,
  onSaved,
  onDelete,
  onBack,
  canGoBack = false,
  onFocus,
  registerSave,
  unregisterSave,
  onAutoSaveComplete,
  onDirty
}: Props) {
  const [title, setTitle] = useState(subject.title);
  const [status, setStatus] = useState(subject.status);
  const [responsibility, setResponsibility] = useState(subject.responsibility || '');
  const [situation, setSituation] = useState(subject.situation || '');
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingResponsibility, setEditingResponsibility] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [focusLineIndex, setFocusLineIndex] = useState<number | null>(null);

  // Track the currently focused/editing line to sync content before save
  const editingLineRef = useRef<number | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);
  const responsibilityRef = useRef<HTMLInputElement>(null);
  const statusPickerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const BULLETS = ['•', '◦', '▪', '▸'];

  // Parse line for indentation and strikethrough
  const parseLine = (line: string): { level: number; text: string; strikethrough: boolean } => {
    const match = line.match(/^(\s*)(.*)/);
    if (!match) return { level: 0, text: line, strikethrough: false };
    const spaces = match[1].length;
    const level = Math.floor(spaces / 2);
    let text = match[2];
    let strikethrough = false;

    // Parse strikethrough (line level)
    if (text.startsWith('~~') && text.endsWith('~~') && text.length > 4) {
      strikethrough = true;
      text = text.slice(2, -2);
    }

    return { level: Math.min(level, BULLETS.length - 1), text, strikethrough };
  };

  // Convert **text** to <strong>text</strong> for display
  const textToHtml = (text: string): string => {
    return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  };

  // Convert <strong>text</strong> back to **text** for storage
  const htmlToText = (html: string): string => {
    // Create a temporary element to handle HTML properly
    const temp = document.createElement('div');
    temp.innerHTML = html;

    // First, replace <br> tags with a unique marker to preserve them
    const brMarker = '___BR_MARKER___';
    temp.innerHTML = temp.innerHTML.replace(/<br\s*\/?>/gi, brMarker);

    // Process the DOM tree to extract text with bold markers
    const processBold = (el: Element): string => {
      let result = '';
      el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          result += node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          const tagName = element.tagName.toLowerCase();
          if (tagName === 'strong' || tagName === 'b') {
            const inner = processBold(element);
            if (inner.trim()) {
              result += '**' + inner + '**';
            }
          } else {
            // For other elements (div, span, etc.), just process their content
            result += processBold(element);
          }
        }
      });
      return result;
    };

    let result = processBold(temp);

    // Convert BR markers back (but we don't want them in our line-based editor)
    result = result.replace(new RegExp(brMarker, 'g'), ' ');

    // Clean up multiple spaces and empty bold markers
    result = result
      .replace(/\*\*\*\*/g, '') // Remove empty bold markers
      .replace(/\s+/g, ' ')     // Normalize whitespace
      .trim();

    return result;
  };

  const getBullet = (level: number): string => BULLETS[Math.min(level, BULLETS.length - 1)];

  // Initialize content from subject
  useEffect(() => {
    setSituation(subject.situation || '');
    setTitle(subject.title);
    setStatus(subject.status);
    setResponsibility(subject.responsibility || '');
  }, [subject.id]); // Re-initialize when subject changes (by ID)

  // Toggle strikethrough (marks line as done)
  const toggleStrikethrough = (lineIndex: number) => {
    setSituation(prev => {
      const lines = prev.split('\n');
      const { level, text, strikethrough } = parseLine(lines[lineIndex]);
      const indent = '  '.repeat(level);

      // Don't apply strikethrough to empty lines
      if (!text.trim()) return prev;

      const newText = strikethrough ? text : '~~' + text + '~~';
      lines[lineIndex] = indent + newText;
      return lines.join('\n');
    });
  };

  useEffect(() => {
    if (editingTitle && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (editingResponsibility && responsibilityRef.current) {
      responsibilityRef.current.focus();
    }
  }, [editingResponsibility]);

  useEffect(() => {
    if (editingContent && containerRef.current) {
      setTimeout(() => {
        const firstInput = containerRef.current?.querySelector(`.${styles.lineInput}`) as HTMLInputElement;
        firstInput?.focus();
      }, 10);
    }
  }, [editingContent]);

  // Focus on specific line after content changes (for Enter key handling)
  useEffect(() => {
    if (focusLineIndex !== null && containerRef.current) {
      requestAnimationFrame(() => {
        const inputs = containerRef.current?.querySelectorAll(`.${styles.lineInput}`);
        if (inputs && inputs[focusLineIndex]) {
          (inputs[focusLineIndex] as HTMLElement).focus();
        }
        setFocusLineIndex(null);
      });
    }
  }, [focusLineIndex, situation]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (statusPickerRef.current && !statusPickerRef.current.contains(e.target as Node)) {
        setShowStatusPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasChanges = useCallback(() => {
    return title !== subject.title ||
           status !== subject.status ||
           responsibility !== (subject.responsibility || '') ||
           situation !== (subject.situation || '');
  }, [title, status, responsibility, situation, subject]);

  // Sync content from DOM - get current value from contentEditable if being edited
  const syncContentFromDOM = useCallback((): string => {
    if (editingLineRef.current === null || !containerRef.current) {
      return situation;
    }

    const inputs = containerRef.current.querySelectorAll('[contenteditable]');
    const currentInput = inputs[editingLineRef.current] as HTMLElement;
    if (!currentInput) {
      return situation;
    }

    const lines = situation.split('\n');
    const lineIdx = editingLineRef.current;
    const originalLine = lines[lineIdx] || '';

    const match = originalLine.match(/^(\s*)(.*)/);
    const spaces = match ? match[1].length : 0;
    const level = Math.floor(spaces / 2);
    let lineText = match ? match[2] : originalLine;
    let strikethrough = false;
    if (lineText.startsWith('~~') && lineText.endsWith('~~') && lineText.length > 4) {
      strikethrough = true;
    }

    const temp = document.createElement('div');
    temp.innerHTML = currentInput.innerHTML;
    temp.innerHTML = temp.innerHTML.replace(/<br\s*\/?>/gi, ' ');
    const processBold = (el: Element): string => {
      let result = '';
      el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          result += node.textContent || '';
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          const tagName = element.tagName.toLowerCase();
          if (tagName === 'strong' || tagName === 'b') {
            const inner = processBold(element);
            if (inner.trim()) {
              result += '**' + inner + '**';
            }
          } else {
            result += processBold(element);
          }
        }
      });
      return result;
    };
    let val = processBold(temp).replace(/\*\*\*\*/g, '').replace(/\s+/g, ' ').trim();
    if (val.trim() === '' || val === '\u00A0') val = '';

    const indent = '  '.repeat(level);
    const newText = (strikethrough && val.trim()) ? '~~' + val + '~~' : val;
    lines[lineIdx] = indent + newText;

    return lines.join('\n');
  }, [situation]);

  // AUTOSAVE - Debounced save when fields change
  const performAutosave = useCallback(async (silent = true) => {
    if (isSaving) return;

    const currentSituation = syncContentFromDOM();

    setIsSaving(true);
    if (!silent) setSaveError(null);

    try {
      // Use the new UUID-based API
      await updateSubject(subject.id, {
        title: title !== subject.title ? title : undefined,
        situation: currentSituation !== (subject.situation || '') ? currentSituation : undefined,
        status: status !== subject.status ? status : undefined,
        responsibility: responsibility !== (subject.responsibility || '') ? responsibility : undefined,
      });

      setSituation(currentSituation);
      setLastSaved(new Date());

      if (!silent) {
        const updatedSubject: Subject = {
          ...subject,
          title,
          status,
          responsibility: responsibility || null,
          situation: currentSituation,
          hasChanges: true,
        };
        onSaved?.(updatedSubject);
      }

      if (silent) {
        onAutoSaveComplete?.();
      }
    } catch (error) {
      console.error('Autosave failed:', error);
      if (!silent) setSaveError('Erreur lors de la sauvegarde');
    } finally {
      setIsSaving(false);
    }
  }, [documentId, subject, title, status, responsibility, situation, isSaving, onSaved, onAutoSaveComplete, syncContentFromDOM]);

  // Track if we need to save (content changed since last save)
  const [pendingSave, setPendingSave] = useState(false);
  const initTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  // Mark initialization complete after component settles (500ms after mount)
  useEffect(() => {
    initTimerRef.current = setTimeout(() => {
      isInitializedRef.current = true;
    }, 500);
    return () => {
      if (initTimerRef.current) clearTimeout(initTimerRef.current);
    };
  }, []);

  // Mark as pending when any field changes (only after initialization)
  useEffect(() => {
    if (!isInitializedRef.current) return;
    setPendingSave(true);
    onDirty?.();
  }, [title, status, responsibility, situation]);

  // Autosave effect with debounce (1.5s after last change)
  useEffect(() => {
    if (!pendingSave || isSaving) return;

    const timeoutId = setTimeout(() => {
      if (editingLineRef.current !== null) {
        return;
      }
      performAutosave(true);
      setPendingSave(false);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [pendingSave, isSaving, performAutosave]);

  // Register this subject's save function with parent for "Save All" feature
  const subjectId = subject.id;
  const forceSave = useCallback(async () => {
    if (hasChanges()) {
      await performAutosave(true);
    }
  }, [hasChanges, performAutosave]);

  useEffect(() => {
    if (registerSave) registerSave(subjectId, forceSave);
    return () => {
      if (unregisterSave) unregisterSave(subjectId);
    };
  }, [subjectId, forceSave, registerSave, unregisterSave]);

  // SAVE TO DATABASE - Direct API call (manual save)
  const handleSave = async () => {
    if (!hasChanges()) return;

    const currentSituation = syncContentFromDOM();

    setIsSaving(true);
    setSaveError(null);

    try {
      await updateSubject(subject.id, {
        title: title !== subject.title ? title : undefined,
        situation: currentSituation,
        status: status !== subject.status ? status : undefined,
        responsibility: responsibility !== (subject.responsibility || '') ? responsibility : undefined,
      });

      setSituation(currentSituation);
      setLastSaved(new Date());
      setEditingContent(false);

      const updatedSubject: Subject = {
        ...subject,
        title,
        status,
        responsibility: responsibility || null,
        situation: currentSituation,
        hasChanges: true,
      };

      onSaved?.(updatedSubject);
    } catch (error) {
      console.error('Failed to save:', error);
      setSaveError('Erreur lors de la sauvegarde');
    } finally {
      setIsSaving(false);
    }
  };

  const handleNext = () => {
    if (hasChanges()) {
      onNext({
        ...subject,
        title,
        status,
        responsibility: responsibility || null,
        situation,
        hasChanges: true,
      });
    } else {
      onNext();
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} ${compact ? styles.compact : ''}`}
    >
      {!compact && (
        <>
          <div className={styles.progress}>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${((sectionIndex + (subjectIndex + 1) / totalSubjects) / totalSections) * 100}%` }}
              />
            </div>
            <span>Section {sectionIndex + 1}/{totalSections} - Sujet {subjectIndex + 1}/{totalSubjects}</span>
          </div>

          <div className={styles.sectionBadge}>{sectionName}</div>
        </>
      )}

      <div className={styles.subjectCard}>
        {/* Header with title and status */}
        <div className={styles.subjectHeader}>
          {editingTitle ? (
            <input
              ref={titleRef}
              type="text"
              className={styles.titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditingTitle(false)}
              placeholder="Titre du sujet"
            />
          ) : (
            <h2
              className={`${styles.titleDisplay} ${title !== subject.title ? styles.changed : ''}`}
              onClick={() => { setEditingTitle(true); onFocus?.(); }}
            >
              {title}
              <span className={styles.editIcon}>&#x270E;</span>
            </h2>
          )}

          {/* Inline Status Picker */}
          <div className={styles.statusWrapper} ref={statusPickerRef}>
            <button
              className={`${styles.statusButton} ${status !== subject.status ? styles.changed : ''}`}
              onClick={() => setShowStatusPicker(!showStatusPicker)}
            >
              {status}
              <span className={styles.editIcon}>&#x270E;</span>
            </button>

            {showStatusPicker && (
              <div className={styles.statusDropdown}>
                {STATUS_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    className={`${styles.statusOption} ${status === opt.value ? styles.selected : ''}`}
                    onClick={() => {
                      setStatus(opt.value);
                      setShowStatusPicker(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {onDelete && (
            <button
              className={styles.deleteBtn}
              onClick={onDelete}
              title="Supprimer ce sujet"
            >
              🗑
            </button>
          )}
        </div>

        {/* Editable Content */}
        <div className={styles.contentSection}>
          <label>Etat de la situation</label>
          {editingContent ? (
            <div className={styles.contentEditor}>
              <div className={styles.editorHint}>
                Tab = indenter | ⇧Tab = désindenter | Enter = nouvelle ligne | ⌘B = gras | ⌘⇧S = fait | Coller = multi-lignes
              </div>
              {situation.split('\n').map((line, i) => {
                const { level, text, strikethrough } = parseLine(line);
                return (
                  <div
                    key={i}
                    className={`${styles.editorLine} ${strikethrough ? styles.strikethroughLine : ''}`}
                    style={{ paddingLeft: `${level * 1.25}rem` }}
                  >
                    <span className={`${styles.bullet} ${styles[`bulletLevel${level}`]}`}>
                      {getBullet(level)}
                    </span>
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      className={`${styles.lineInput} ${strikethrough ? styles.strikethroughInput : ''}`}
                      dangerouslySetInnerHTML={{ __html: textToHtml(text) || '&nbsp;' }}
                      onFocus={() => {
                        editingLineRef.current = i;
                      }}
                      onBlur={(e) => {
                        editingLineRef.current = null;
                        const div = e.currentTarget;
                        let val = htmlToText(div.innerHTML);
                        if (val.trim() === '' || val === '\u00A0') val = '';
                        const indent = '  '.repeat(level);
                        const newText = (strikethrough && val.trim()) ? '~~' + val + '~~' : val;
                        setSituation(prev => {
                          const lines = prev.split('\n');
                          lines[i] = indent + newText;
                          return lines.join('\n');
                        });
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pastedText = e.clipboardData.getData('text/plain');
                        const pastedLines = pastedText.split(/\r?\n/).filter(l => l.trim());

                        if (pastedLines.length <= 1) {
                          document.execCommand('insertText', false, pastedText.trim());
                        } else {
                          const currentIndent = '  '.repeat(level);
                          const div = e.currentTarget;
                          const currentVal = htmlToText(div.innerHTML);

                          const firstLine = currentVal + (currentVal ? ' ' : '') + pastedLines[0].trim();
                          const newLines = pastedLines.slice(1).map(l => currentIndent + l.trim());

                          setSituation(prev => {
                            const lines = prev.split('\n');
                            lines[i] = currentIndent + firstLine;
                            lines.splice(i + 1, 0, ...newLines);
                            return lines.join('\n');
                          });
                          setFocusLineIndex(i + pastedLines.length - 1);
                        }
                      }}
                      onKeyDown={(e) => {
                        const lines = situation.split('\n');
                        const div = e.currentTarget;
                        if (e.key === 'b' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                          e.preventDefault();
                          document.execCommand('bold', false);
                          setTimeout(() => {
                            const val = htmlToText(div.innerHTML);
                            const indent = '  '.repeat(level);
                            const newText = (strikethrough && val.trim()) ? '~~' + val + '~~' : val;
                            lines[i] = indent + newText;
                            setSituation(lines.join('\n'));
                          }, 0);
                        } else if (e.key === 's' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
                          e.preventDefault();
                          toggleStrikethrough(i);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = htmlToText(div.innerHTML);
                          const currentIndent = '  '.repeat(level);
                          const currentText = (strikethrough && val.trim()) ? '~~' + val + '~~' : val;
                          lines[i] = currentIndent + currentText;
                          const indent = '  '.repeat(level);
                          lines.splice(i + 1, 0, indent);
                          setSituation(lines.join('\n'));
                          setFocusLineIndex(i + 1);
                        } else if (e.key === 'Tab') {
                          e.preventDefault();
                          const val = htmlToText(div.innerHTML);
                          if (e.shiftKey) {
                            if (level > 0) {
                              const newText = strikethrough ? '~~' + val + '~~' : val;
                              lines[i] = '  '.repeat(level - 1) + newText;
                              setSituation(lines.join('\n'));
                            }
                          } else {
                            if (level < 3) {
                              const newText = strikethrough ? '~~' + val + '~~' : val;
                              lines[i] = '  '.repeat(level + 1) + newText;
                              setSituation(lines.join('\n'));
                            }
                          }
                        } else if (e.key === 'Backspace') {
                          const val = htmlToText(div.innerHTML);
                          if (val === '' && lines.length > 1) {
                            e.preventDefault();
                            lines.splice(i, 1);
                            setSituation(lines.join('\n'));
                            setFocusLineIndex(Math.max(0, i - 1));
                          }
                        }
                      }}
                      data-placeholder="Nouvelle ligne..."
                    />
                    <button
                      type="button"
                      className={`${styles.checkBtn} ${strikethrough ? styles.active : ''}`}
                      onClick={() => toggleStrikethrough(i)}
                      title="Marquer comme fait (⌘⇧S)"
                    >
                      ✓
                    </button>
                    {situation.split('\n').length > 1 && (
                      <button
                        type="button"
                        className={styles.deleteLineBtn}
                        onClick={() => {
                          setSituation(prev => {
                            const lines = prev.split('\n');
                            lines.splice(i, 1);
                            return lines.join('\n');
                          });
                          if (i > 0) setFocusLineIndex(i - 1);
                        }}
                        title="Supprimer la ligne"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
              <button
                className={styles.addLineBtn}
                onClick={() => setSituation(prev => prev + '\n')}
              >
                + Ajouter une ligne
              </button>
            </div>
          ) : (
            <div
              className={`${styles.contentDisplay} ${situation !== (subject.situation || '') ? styles.changed : ''}`}
              onClick={() => { setEditingContent(true); onFocus?.(); }}
            >
              {situation.split('\n').map((line, i) => {
                const { level, text, strikethrough } = parseLine(line);
                if (!text.trim()) return <div key={i} className={styles.emptyLine} />;
                return (
                  <div
                    key={i}
                    className={`${styles.contentLine} ${strikethrough ? styles.strikethroughDisplay : ''}`}
                    style={{ paddingLeft: `${level * 1.25}rem` }}
                  >
                    <span className={`${styles.bullet} ${styles[`bulletLevel${level}`]}`}>
                      {getBullet(level)}
                    </span>
                    {strikethrough ? (
                      <s dangerouslySetInnerHTML={{ __html: textToHtml(text) }} />
                    ) : (
                      <span dangerouslySetInnerHTML={{ __html: textToHtml(text) }} />
                    )}
                  </div>
                );
              })}
              <span className={styles.editHint}>Cliquer pour modifier</span>
            </div>
          )}
        </div>

        {/* Editable Responsibility */}
        <div className={styles.responsibilitySection}>
          <label>Responsable</label>
          {editingResponsibility ? (
            <input
              ref={responsibilityRef}
              type="text"
              className={styles.responsibilityInput}
              value={responsibility}
              onChange={(e) => setResponsibility(e.target.value)}
              onBlur={() => setEditingResponsibility(false)}
              onKeyDown={(e) => e.key === 'Enter' && setEditingResponsibility(false)}
              placeholder="@Nom ou equipe"
            />
          ) : (
            <div
              className={`${styles.responsibilityDisplay} ${responsibility !== (subject.responsibility || '') ? styles.changed : ''}`}
              onClick={() => { setEditingResponsibility(true); onFocus?.(); }}
            >
              {responsibility || <span className={styles.placeholder}>Non assigne</span>}
              <span className={styles.editIcon}>&#x270E;</span>
            </div>
          )}
        </div>

        {/* Status indicator */}
        <div className={styles.changeIndicator}>
          <div className={styles.changeStatus}>
            {saveError ? (
              <span className={styles.errorBadge}>{saveError}</span>
            ) : isSaving ? (
              <span className={styles.savingBadge}>
                <span className={styles.miniSpinner}></span>
                Sauvegarde auto...
              </span>
            ) : pendingSave ? (
              <span className={styles.pendingBadge}>Modifications en attente...</span>
            ) : lastSaved ? (
              <span className={styles.savedBadge}>✓ Sauvegardé à {lastSaved.toLocaleTimeString('fr-FR')}</span>
            ) : null}
          </div>
        </div>
      </div>

      {!compact && (
        <div className={styles.actions}>
          {canGoBack && (
            <button className={styles.backBtn} onClick={onBack}>
              Retour
            </button>
          )}
          <button className={styles.nextBtn} onClick={handleNext}>
            {subjectIndex === totalSubjects - 1
              ? 'Fin de section'
              : 'Sujet suivant'}
          </button>
        </div>
      )}
    </div>
  );
}
