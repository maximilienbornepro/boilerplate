import { useState, useEffect, useRef, useCallback } from 'react';
import type { Section } from '../../types';
import styles from './TableOfContents.module.css';

interface DragItem {
  type: 'section' | 'subject';
  sectionIdx: number;
  subjectIdx?: number;
}

interface DropTarget {
  type: 'section' | 'subject';
  sectionIdx: number;
  subjectIdx?: number;
  position: 'before' | 'after';
}

interface Props {
  sections: Section[];
  containerRef: React.RefObject<HTMLElement | null>;
  focusedItem?: string | null;
  onReorderSubject?: (sectionIdx: number, fromSubjectIdx: number, toSubjectIdx: number) => void;
  onReorderSection?: (fromIdx: number, toIdx: number) => void;
  onReorderSubjectToSection?: (fromSectionIdx: number, fromSubjectIdx: number, toSectionIdx: number, toSubjectIdx: number) => void;
}

export function TableOfContents({ sections, containerRef, focusedItem, onReorderSubject, onReorderSection, onReorderSubjectToSection }: Props) {
  const [activeItem, setActiveItem] = useState('subject-0-0');
  const navRef = useRef<HTMLElement>(null);
  const updateActiveRef = useRef<(() => void) | null>(null);

  // Drag state
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Create stable updateActive function
  updateActiveRef.current = () => {
    const cards = document.querySelectorAll('[data-subject-id]');
    if (cards.length === 0) return;

    const targetY = window.innerHeight * 0.3;
    let closest: string | null = null;
    let closestDist = Infinity;

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      const dist = Math.abs(center - targetY);
      if (dist < closestDist) {
        closestDist = dist;
        closest = card.getAttribute('data-subject-id');
      }
    });

    if (closest) setActiveItem(closest);
  };

  const scrollNavToItem = (itemId: string) => {
    if (!navRef.current) return;
    const targetButton = navRef.current.querySelector(`[data-toc-id="${itemId}"]`) as HTMLElement;
    if (!targetButton) return;

    const nav = navRef.current;
    const buttonRect = targetButton.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();

    const buttonTop = buttonRect.top - navRect.top + nav.scrollTop;
    const buttonBottom = buttonTop + buttonRect.height;
    const visibleTop = nav.scrollTop;
    const visibleBottom = nav.scrollTop + navRect.height;

    if (buttonTop < visibleTop) {
      nav.scrollTo({ top: buttonTop - 10, behavior: 'smooth' });
    } else if (buttonBottom > visibleBottom) {
      nav.scrollTo({ top: buttonBottom - navRect.height + 10, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (focusedItem) scrollNavToItem(focusedItem);
  }, [focusedItem]);

  useEffect(() => {
    scrollNavToItem(activeItem);
  }, [activeItem]);

  useEffect(() => {
    const handleScroll = () => { updateActiveRef.current?.(); };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToSubject = (sectionIndex: number, subjectIndex: number) => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-subject-id="subject-${sectionIndex}-${subjectIndex}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // --- Drag & Drop ---

  const handleDragStart = useCallback((e: React.DragEvent, item: DragItem) => {
    setDragItem(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.4';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1';
    }
    setDragItem(null);
    setDropTarget(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, target: Omit<DropTarget, 'position'>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragItem) return;

    if (dragItem.type === 'section' && target.type !== 'section') return;

    if (dragItem.type === 'subject' && target.type === 'section') {
      if (!onReorderSubjectToSection && dragItem.sectionIdx !== target.sectionIdx) return;
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const position = e.clientY < midY ? 'before' : 'after';

    setDropTarget({ ...target, position });
  }, [dragItem, onReorderSubjectToSection]);

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!dragItem || !dropTarget) return;

    if (dragItem.type === 'section' && dropTarget.type === 'section' && onReorderSection) {
      let toIdx = dropTarget.sectionIdx;
      if (dropTarget.position === 'after') toIdx += 1;
      if (toIdx > dragItem.sectionIdx) toIdx -= 1;
      if (toIdx !== dragItem.sectionIdx) {
        onReorderSection(dragItem.sectionIdx, toIdx);
      }
    }

    if (dragItem.type === 'subject' && dragItem.subjectIdx !== undefined) {
      if (dropTarget.type === 'section' && onReorderSubjectToSection) {
        const targetSectionIdx = dropTarget.sectionIdx;
        if (targetSectionIdx !== dragItem.sectionIdx) {
          const targetSubjectCount = sections[targetSectionIdx]?.subjects.length ?? 0;
          onReorderSubjectToSection(dragItem.sectionIdx, dragItem.subjectIdx, targetSectionIdx, targetSubjectCount);
        }
      }

      if (dropTarget.type === 'subject' && dropTarget.subjectIdx !== undefined) {
        if (dragItem.sectionIdx === dropTarget.sectionIdx && onReorderSubject) {
          let toIdx = dropTarget.subjectIdx;
          if (dropTarget.position === 'after') toIdx += 1;
          if (toIdx > dragItem.subjectIdx) toIdx -= 1;
          if (toIdx !== dragItem.subjectIdx) {
            onReorderSubject(dragItem.sectionIdx, dragItem.subjectIdx, toIdx);
          }
        } else if (dragItem.sectionIdx !== dropTarget.sectionIdx && onReorderSubjectToSection) {
          let toIdx = dropTarget.subjectIdx;
          if (dropTarget.position === 'after') toIdx += 1;
          onReorderSubjectToSection(dragItem.sectionIdx, dragItem.subjectIdx, dropTarget.sectionIdx, toIdx);
        }
      }
    }

    setDragItem(null);
    setDropTarget(null);
  }, [dragItem, dropTarget, onReorderSection, onReorderSubject, onReorderSubjectToSection, sections]);

  const getDropIndicator = (type: 'section' | 'subject', sectionIdx: number, subjectIdx?: number): 'before' | 'after' | null => {
    if (!dropTarget || !dragItem) return null;
    if (dropTarget.type !== type || dropTarget.sectionIdx !== sectionIdx) return null;
    if (type === 'subject' && dropTarget.subjectIdx !== subjectIdx) return null;

    if (dragItem.type === type && dragItem.sectionIdx === sectionIdx) {
      if (type === 'section') return null;
      if (type === 'subject' && dragItem.subjectIdx === subjectIdx) return null;
    }

    return dropTarget.position;
  };

  const isDraggable = !!(onReorderSubject || onReorderSection);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <h3>Sommaire</h3>
      </div>

      <nav className={styles.nav} ref={navRef}>
        {sections.map((section, sIdx) => {
          const sectionIndicator = getDropIndicator('section', sIdx);
          const isDraggingSelf = dragItem?.type === 'section' && dragItem.sectionIdx === sIdx;

          return (
            <div
              key={sIdx}
              className={`${styles.sectionGroup} ${isDraggingSelf ? styles.dragging : ''}`}
            >
              {sectionIndicator === 'before' && <div className={styles.dropIndicator} />}
              <div
                className={styles.sectionTitle}
                draggable={isDraggable}
                onDragStart={(e) => handleDragStart(e, { type: 'section', sectionIdx: sIdx })}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, { type: 'section', sectionIdx: sIdx })}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isDraggable && <span className={styles.dragHandle}>⠿</span>}
                {section.name}
              </div>
              {sectionIndicator === 'after' && <div className={styles.dropIndicator} />}
              <ul className={styles.itemList}>
                {section.subjects.map((subject, subIdx) => {
                  const itemId = `subject-${sIdx}-${subIdx}`;
                  const isActive = activeItem === itemId;
                  const subjectIndicator = getDropIndicator('subject', sIdx, subIdx);
                  const isDraggingSubject = dragItem?.type === 'subject' && dragItem.sectionIdx === sIdx && dragItem.subjectIdx === subIdx;

                  return (
                    <li key={itemId} className={isDraggingSubject ? styles.dragging : ''}>
                      {subjectIndicator === 'before' && <div className={styles.dropIndicator} />}
                      <button
                        className={`${styles.item} ${isActive ? styles.active : ''}`}
                        onClick={() => scrollToSubject(sIdx, subIdx)}
                        data-toc-id={itemId}
                        draggable={isDraggable}
                        onDragStart={(e) => {
                          e.stopPropagation();
                          handleDragStart(e, { type: 'subject', sectionIdx: sIdx, subjectIdx: subIdx });
                        }}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => {
                          e.stopPropagation();
                          handleDragOver(e, { type: 'subject', sectionIdx: sIdx, subjectIdx: subIdx });
                        }}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => {
                          e.stopPropagation();
                          handleDrop(e);
                        }}
                      >
                        {isDraggable && <span className={styles.dragHandle}>⠿</span>}
                        <span className={styles.indicator} />
                        <span className={styles.itemTitle}>{subject.title}</span>
                      </button>
                      {subjectIndicator === 'after' && <div className={styles.dropIndicator} />}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
