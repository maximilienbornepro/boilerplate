import type { ReactNode } from 'react';
import styles from './AiReviewWizard.module.css';

export interface TileProgressItem {
  /** Stable key used for React + click navigation. */
  id: string;
  /** Shown as dot tooltip (ex: "3. Mise en prod version 1.24.1"). */
  title: string;
}

export interface TileProgressProps {
  /** The full list of reviewable items. Dots are one-to-one with this
   *  array; the current item's dot is highlighted. */
  items: TileProgressItem[];
  /** ID of the currently-displayed item. When null, no dot is
   *  highlighted and both nav arrows are disabled. */
  currentId: string | null;
  /** Fired when the user clicks a dot or a nav arrow. Parent owns the
   *  navigation state (controlled component). */
  onNavigate: (id: string) => void;
  /** Optional "Sujet {position} sur {total}" override. When omitted,
   *  defaults to (items.indexOf(currentId) + 1) / items.length —
   *  useful when the parent tracks a different "position" context
   *  (ex: SuiviTess shows "Sujet 3 sur 26" including already-handled
   *  ones, while `items` only has the remaining rows). */
  position?: number;
  total?: number;
  /** Extra free-form stats rendered on the right of the position
   *  (ex: `3 importés — 1 ignoré — 22 restants`). Consumers fully
   *  control the markup so they can mix counters, pills, links. */
  extraStats?: ReactNode;
  /** Disables navigation — both arrows + dot clicks become no-ops
   *  with a dimmed appearance. Typical use: a commit is in-flight
   *  and we don't want the user jumping to another tile mid-write. */
  disableNav?: boolean;
  /** Custom label overrides for accessibility / i18n. */
  labels?: {
    positionLead?: string;     // default: "Sujet"
    prev?: string;             // default: "Sujet précédent"
    next?: string;             // default: "Sujet suivant"
    navAriaLabel?: string;     // default: "Navigation entre sujets"
  };
}

/** Presentational tile progress header — "{position} sur {total}" + a
 *  row of clickable dots with prev/next arrows. Fully controlled:
 *  the parent owns `currentId` and handles navigation via
 *  {@link onNavigate}. No internal state, no state machine.
 *
 *  Used internally by {@link AiReviewWizard}, exported standalone for
 *  consumers that already have their own state machine and just want
 *  to reuse the visual pattern (ex: SuiviTess bulk-import modal). */
export function TileProgress({
  items,
  currentId,
  onNavigate,
  position,
  total,
  extraStats,
  disableNav = false,
  labels,
}: TileProgressProps) {
  const currentIdx = currentId == null ? -1 : items.findIndex(it => it.id === currentId);
  const displayPosition = position ?? (currentIdx >= 0 ? currentIdx + 1 : 0);
  const displayTotal = total ?? items.length;
  const prevId = currentIdx > 0 ? items[currentIdx - 1].id : null;
  const nextId = currentIdx >= 0 && currentIdx < items.length - 1
    ? items[currentIdx + 1].id
    : null;

  const l = {
    positionLead: labels?.positionLead ?? 'Sujet',
    prev: labels?.prev ?? 'Sujet précédent',
    next: labels?.next ?? 'Sujet suivant',
    navAriaLabel: labels?.navAriaLabel ?? 'Navigation entre sujets',
  };

  return (
    <div className={styles.tileProgress}>
      <div className={styles.tileProgressHeader}>
        <strong className={styles.tileProgressPos}>
          {l.positionLead} {displayPosition} sur {displayTotal}
        </strong>
        {extraStats && (
          <span className={styles.tileProgressStats}>{extraStats}</span>
        )}
      </div>

      <div className={styles.tileDotsRow} role="tablist" aria-label={l.navAriaLabel}>
        <button
          type="button"
          className={styles.tileNavArrow}
          onClick={() => prevId && onNavigate(prevId)}
          disabled={disableNav || !prevId}
          title={prevId ? l.prev : 'Aucun sujet précédent'}
          aria-label={l.prev}
        >
          ←
        </button>
        <div className={styles.tileDots}>
          {items.map((it, idx) => (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={it.id === currentId}
              className={`${styles.tileDot} ${it.id === currentId ? styles.tileDotCurrent : ''}`}
              onClick={() => !disableNav && onNavigate(it.id)}
              title={`${idx + 1}. ${it.title}`}
              disabled={disableNav}
            />
          ))}
        </div>
        <button
          type="button"
          className={styles.tileNavArrow}
          onClick={() => nextId && onNavigate(nextId)}
          disabled={disableNav || !nextId}
          title={nextId ? `${l.next} (sans l'importer)` : 'Aucun sujet suivant'}
          aria-label={l.next}
        >
          →
        </button>
      </div>
    </div>
  );
}
