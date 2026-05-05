import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { CVAdaptationTile } from '../../types';
import './AdaptCVTilesModal.css';

interface Props {
  cvId: number;
  jobOffer: string;
  /** When set, skip the "create new adaptation" path and resume an
   *  existing draft : the modal fetches its tiles, infers the right
   *  phase from their state (selecting / adapting / routing), and
   *  picks up where the user left off. */
  resumeAdaptationId?: number;
  onClose: () => void;
  onDone: (adaptationId: number) => void;
}

type Phase = 'extracting' | 'selecting' | 'adapting' | 'routing' | 'done' | 'error';

/** CV adaptation flow inspired by the suivitess BulkTranscriptionImportModal :
 *  visible step indicator + per-tile reasoning + agree/disagree CTAs +
 *  pre-selection of which atomics to adapt (saves tokens by skipping
 *  parts the user isn't interested in).
 *
 *  Phases :
 *    1. extracting  — skill A flattens the CV into atomic subjects (~60s)
 *    2. selecting   — user ticks which subjects to adapt (default = all)
 *    3. adapting    — skill B runs in background ; modal polls /tiles
 *    4. routing     — tile-by-tile validation, ONLY tiles where the
 *                     proposal differs from the original
 *    5. done        — redirect to AdaptationDetailPage
 */
export function AdaptCVTilesModal({ cvId, jobOffer, resumeAdaptationId, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('extracting');
  const [adaptationId, setAdaptationId] = useState<number | null>(null);
  const [tiles, setTiles] = useState<CVAdaptationTile[]>([]);
  const [selectedTileIds, setSelectedTileIds] = useState<Set<string>>(new Set());
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // User-picked adaptation mode. Drives which prompt skill B uses :
  //   classic    → faithful rewriting only (no new skills)
  //   aggressive → louder ATS rewriting + suggested skill additions
  // Locked once the user clicks "Lancer l'adaptation IA" — the modal
  // keeps it for the regenerate calls so single-tile regen matches the
  // batch run's tone.
  const [mode, setMode] = useState<'classic' | 'aggressive'>('classic');

  // Per-tile UI state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');
  const [busyTileId, setBusyTileId] = useState<string | null>(null);

  // ── 1. Extract atomics on mount ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (resumeAdaptationId) {
          // Resume path : the user reopened a draft from the
          // AdaptCVPage. Pull its existing tiles and infer the
          // phase :
          //  - If skill B never ran (no proposalReady=true) → back
          //    to `selecting` so the user can pick subset & mode.
          //  - If some proposals are ready and some are still
          //    pending → `adapting` (the polling loop will catch up
          //    if a background run is mid-flight, otherwise jumps
          //    straight to routing on the next tick).
          //  - If there are still pending tiles → `routing` to
          //    walk through them.
          //  - If everything is done (accepted/skipped) → `done`.
          const tiles = await api.fetchTilesForAdaptation(resumeAdaptationId);
          if (cancelled) return;
          setAdaptationId(resumeAdaptationId);
          setTiles(tiles);
          // Re-include every tile that already has a proposal in
          // the selection — they're the ones skill B touched, so
          // the resume path keeps them in scope.
          const adapted = tiles.filter(t => t.proposalReady);
          if (adapted.length === 0) {
            setSelectedTileIds(new Set(tiles.map(t => t.tileId)));
            setPhase('selecting');
          } else {
            setSelectedTileIds(new Set(adapted.map(t => t.tileId)));
            const stillPending = adapted.some(
              t => t.status === 'pending' && t.proposedText.trim() !== t.originalText.trim()
            );
            setPhase(stillPending ? 'routing' : 'done');
          }
          return;
        }

        const res = await api.startTileAdaptation(cvId, jobOffer);
        if (cancelled) return;
        setAdaptationId(res.adaptationId);
        setTiles(res.tiles);
        // Default selection : everything. The user trims down what they
        // don't want before paying for skill B.
        setSelectedTileIds(new Set(res.tiles.map(t => t.tileId)));
        setPhase('selecting');
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cvId, jobOffer, resumeAdaptationId]);

  // ── 3. Poll /tiles while skill B is running ─────────────────────────
  // Important : we check `proposalReady` ONLY on the tiles the user
  // SELECTED for adaptation. Tiles outside the selection never get
  // a skill-B run, so they stay `proposalReady=false` forever — if
  // we waited on `tiles.every(...)` the modal would be stuck on
  // `adapting` indefinitely.
  useEffect(() => {
    if (phase !== 'adapting' && phase !== 'routing') return;
    if (adaptationId === null) return;
    const watched = tiles.filter(t => selectedTileIds.has(t.tileId));
    if (watched.length === 0 || watched.every(t => t.proposalReady)) {
      if (phase === 'adapting') setPhase('routing');
      return;
    }
    let cancelled = false;
    const intervalId = setInterval(async () => {
      try {
        const fresh = await api.fetchTilesForAdaptation(adaptationId);
        if (cancelled) return;
        setTiles(prev => {
          const prevById = new Map(prev.map(t => [t.id, t]));
          // Merge : for known tiles, sync only the skill-B fields
          // (preserves user edits in flight) ; for NEW tiles
          // (aggressive-mode additions inserted server-side after
          // skill B ran), append them as-is.
          return fresh.map(f => {
            const existing = prevById.get(f.id);
            if (!existing) return f;
            return {
              ...existing,
              proposedText: f.proposedText,
              proposalReady: f.proposalReady,
              reasoning: f.reasoning,
              regenerateCount: f.regenerateCount,
              aiLogId: f.aiLogId,
            };
          });
        });
        // Auto-include any newly-inserted addition tiles in the
        // selection so visibleModifiedTiles surfaces them — the
        // user picks accept/reject per addition in the routing UI.
        setSelectedTileIds(prev => {
          let changed = false;
          const next = new Set(prev);
          for (const f of fresh) {
            if (f.kind.endsWith('_addition') && !next.has(f.tileId)) {
              next.add(f.tileId);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      } catch { /* swallow ; next tick retries */ }
    }, 4000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [phase, adaptationId, tiles, selectedTileIds]);

  // Once we transition to 'routing', set the first ready & modified
  // tile (within the user's selection) as the active one. If skill B
  // produced no diff at all, fast-forward to 'done'.
  useEffect(() => {
    if (phase !== 'routing' || activeTileId !== null) return;
    const first = visibleModifiedTiles(tiles).find(t => selectedTileIds.has(t.tileId));
    if (first) setActiveTileId(first.id);
    else setPhase('done');
  }, [phase, activeTileId, tiles, selectedTileIds]);

  // Once we land in `done`, mark the adaptation completed server-
  // side so the AdaptCVPage drafts list stops surfacing it. Fire-
  // and-forget — failure is non-fatal (the draft simply stays
  // resumable, which is the safe behaviour).
  useEffect(() => {
    if (phase !== 'done' || adaptationId === null) return;
    api.completeTileAdaptation(adaptationId).catch(() => { /* swallow */ });
  }, [phase, adaptationId]);

  // ── 2. Selection actions ────────────────────────────────────────────
  const sectionGroups = useMemo(() => groupTilesBySection(tiles), [tiles]);

  const toggleTile = (tileId: string) => {
    setSelectedTileIds(prev => {
      const next = new Set(prev);
      if (next.has(tileId)) next.delete(tileId);
      else next.add(tileId);
      return next;
    });
  };
  const toggleGroup = (group: SectionGroup) => {
    const allSelected = group.tiles.every(t => selectedTileIds.has(t.tileId));
    setSelectedTileIds(prev => {
      const next = new Set(prev);
      for (const t of group.tiles) {
        if (allSelected) next.delete(t.tileId);
        else next.add(t.tileId);
      }
      return next;
    });
  };

  const startAdaptation = async () => {
    if (!adaptationId || selectedTileIds.size === 0) return;
    setPhase('adapting');
    try {
      await api.runAdaptOnSelected(adaptationId, Array.from(selectedTileIds), mode);
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    }
  };

  // ── 4. Routing actions ──────────────────────────────────────────────
  // visibleTiles : only the user-selected tiles where skill B
  // actually changed something. The unselected ones get filtered
  // out (their proposalReady stays false forever), so they're
  // implicitly excluded — but scoping by selectedTileIds makes the
  // intent explicit.
  const visibleTiles = useMemo(
    () => visibleModifiedTiles(tiles).filter(t => selectedTileIds.has(t.tileId)),
    [tiles, selectedTileIds],
  );
  const activeTile = useMemo(() => tiles.find(t => t.id === activeTileId) ?? null, [tiles, activeTileId]);

  const advance = useCallback(() => {
    setEditingId(null);
    setEditDraft('');
    const remaining = visibleTiles.filter(t => t.status === 'pending' && t.id !== activeTileId);
    if (remaining.length === 0) {
      setPhase('done');
      return;
    }
    const ready = remaining.find(t => t.proposalReady);
    setActiveTileId((ready ?? remaining[0]).id);
  }, [visibleTiles, activeTileId]);

  const replaceTile = (updated: CVAdaptationTile) => {
    setTiles(prev => prev.map(t => (t.id === updated.id ? updated : t)));
  };

  const handleAccept = async () => {
    if (!adaptationId || !activeTile) return;
    setBusyTileId(activeTile.id);
    try {
      const updated = await api.updateTile(adaptationId, activeTile.id, { status: 'accepted' });
      replaceTile(updated);
      advance();
    } catch (err) { setError((err as Error).message); }
    finally { setBusyTileId(null); }
  };

  const handleSkip = async () => {
    if (!adaptationId || !activeTile) return;
    setBusyTileId(activeTile.id);
    try {
      const updated = await api.updateTile(adaptationId, activeTile.id, { status: 'skipped' });
      replaceTile(updated);
      advance();
    } catch (err) { setError((err as Error).message); }
    finally { setBusyTileId(null); }
  };

  const handleStartEdit = () => {
    if (!activeTile) return;
    setEditingId(activeTile.id);
    setEditDraft(activeTile.userEditedText ?? activeTile.proposedText);
  };

  const handleSaveEdit = async () => {
    if (!adaptationId || !activeTile) return;
    setBusyTileId(activeTile.id);
    try {
      const updated = await api.updateTile(adaptationId, activeTile.id, {
        status: 'edited',
        userEditedText: editDraft,
      });
      replaceTile(updated);
      advance();
    } catch (err) { setError((err as Error).message); }
    finally { setBusyTileId(null); }
  };

  const handleRevert = async () => {
    if (!adaptationId || !activeTile) return;
    setEditingId(null);
    setEditDraft('');
    setBusyTileId(activeTile.id);
    try {
      const updated = await api.updateTile(adaptationId, activeTile.id, {
        status: 'pending',
        userEditedText: null,
      });
      replaceTile(updated);
    } catch (err) { setError((err as Error).message); }
    finally { setBusyTileId(null); }
  };

  const handleRegenerate = async () => {
    if (!adaptationId || !activeTile) return;
    setBusyTileId(activeTile.id);
    try {
      const updated = await api.regenerateTile(adaptationId, activeTile.id, mode);
      replaceTile(updated);
      setEditingId(null);
      setEditDraft('');
    } catch (err) { setError((err as Error).message); }
    finally { setBusyTileId(null); }
  };

  // ── Render ──────────────────────────────────────────────────────────
  const headerTitle =
    phase === 'extracting' ? 'Analyse du CV…'
    : phase === 'selecting' ? 'Choisis les sections à adapter'
    : phase === 'adapting' ? 'L\'IA adapte ton CV à l\'offre…'
    : phase === 'done' ? 'Adaptation terminée'
    : phase === 'error' ? 'Erreur'
    : 'Validation tuile par tuile';

  return (
    <Modal title={headerTitle} onClose={onClose} size="xl">
      <div className="adapt-cv-tiles">
        {error && <div className="adapt-cv-tiles__error">⚠ {error}</div>}

        {(phase === 'extracting' || phase === 'adapting') && (
          <PipelineStepsIndicator phase={phase} tiles={tiles} selectedCount={selectedTileIds.size} />
        )}

        {phase === 'selecting' && (
          <SelectionPanel
            sectionGroups={sectionGroups}
            selectedTileIds={selectedTileIds}
            onToggleTile={toggleTile}
            onToggleGroup={toggleGroup}
            onStart={startAdaptation}
            onCancel={onClose}
            mode={mode}
            onChangeMode={setMode}
          />
        )}

        {phase === 'routing' && activeTile && (
          <RoutingTile
            tile={activeTile}
            position={visibleTiles.findIndex(t => t.id === activeTile.id) + 1}
            total={visibleTiles.length}
            editingId={editingId}
            editDraft={editDraft}
            busy={busyTileId === activeTile.id}
            onChangeDraft={setEditDraft}
            onAccept={handleAccept}
            onSkip={handleSkip}
            onStartEdit={handleStartEdit}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={() => { setEditingId(null); setEditDraft(''); }}
            onRevert={handleRevert}
            onRegenerate={handleRegenerate}
          />
        )}

        {phase === 'routing' && !activeTile && tiles.length > 0 && visibleTiles.length === 0 && (
          <div className="adapt-cv-tiles__done">
            <p>L'IA n'a proposé aucune modification (le CV est déjà aligné avec l'offre, ou la sélection ne contenait rien à ajuster).</p>
            <div className="adapt-cv-tiles__done-actions">
              <Button variant="secondary" onClick={onClose}>Fermer</Button>
              {adaptationId !== null && (
                <Button variant="primary" onClick={() => onDone(adaptationId)}>
                  Voir l'adaptation
                </Button>
              )}
            </div>
          </div>
        )}

        {phase === 'done' && adaptationId !== null && (
          <div className="adapt-cv-tiles__done">
            <p>Toutes les modifications ont été passées en revue. Tu peux maintenant télécharger le CV adapté en PDF ou continuer à le modifier dans l'éditeur.</p>
            <div className="adapt-cv-tiles__done-actions">
              <Button variant="secondary" onClick={onClose}>Fermer</Button>
              <Button variant="primary" onClick={() => onDone(adaptationId)}>
                Voir l'adaptation
              </Button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="adapt-cv-tiles__done">
            <p className="adapt-cv-tiles__error-msg">⚠ {error}</p>
            <Button variant="secondary" onClick={onClose}>Fermer</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

interface SectionGroup {
  key: string;
  label: string;
  tiles: CVAdaptationTile[];
}

/** Group tiles into user-meaningful sections : one group per top-level
 *  CV field (summary, competences, …) PLUS one group per experience
 *  index (so the user can pick a single experience). */
function groupTilesBySection(tiles: CVAdaptationTile[]): SectionGroup[] {
  const groups = new Map<string, SectionGroup>();
  const ensure = (key: string, label: string): SectionGroup => {
    let g = groups.get(key);
    if (!g) { g = { key, label, tiles: [] }; groups.set(key, g); }
    return g;
  };
  for (const t of tiles) {
    // experiences[i].xxx → group by experience index. Use the company
    // name from the tile's `label` ("France.TV — Mission #1" → "France.TV")
    // when available so the user sees real employer names instead of
    // anonymous "Expérience #1".
    const expMatch = t.path.match(/^experiences\[(\d+)\]/);
    if (expMatch) {
      const idx = expMatch[1];
      const company = t.label?.split(' — ')[0]?.trim();
      const label = company
        ? `Expérience #${parseInt(idx, 10) + 1} — ${company}`
        : `Expérience #${parseInt(idx, 10) + 1}`;
      ensure(`experience-${idx}`, label).tiles.push(t);
      continue;
    }
    // sideProjects.items[i].xxx
    const spMatch = t.path.match(/^sideProjects\.items\[(\d+)\]/);
    if (spMatch) {
      ensure('sideProjects', 'Side projects').tiles.push(t);
      continue;
    }
    // Top-level fields → use kind for the label.
    if (t.kind === 'summary' || t.path === 'summary') {
      ensure('summary', 'Présentation').tiles.push(t);
    } else if (t.kind === 'professional_title' || t.path === 'title') {
      ensure('title', 'Titre professionnel').tiles.push(t);
    } else if (t.kind === 'language' || t.path.startsWith('languages')) {
      ensure('languages', 'Langues').tiles.push(t);
    } else if (t.kind.startsWith('skill_') || t.path.startsWith('competences')
      || t.path.startsWith('outils') || t.path.startsWith('dev')
      || t.path.startsWith('frameworks') || t.path.startsWith('solutions')) {
      ensure('skills', 'Compétences').tiles.push(t);
    } else if (t.path.startsWith('formations')) {
      ensure('formations', 'Formations').tiles.push(t);
    } else if (t.path.startsWith('awards')) {
      ensure('awards', 'Distinctions').tiles.push(t);
    } else {
      ensure('other', 'Autre').tiles.push(t);
    }
  }
  return Array.from(groups.values());
}

/** Tiles surfaced in the routing phase — only those the AI actually
 *  modified (skill B output ≠ original_text). Identical proposals
 *  are auto-accepted server-side later. */
function visibleModifiedTiles(tiles: CVAdaptationTile[]): CVAdaptationTile[] {
  return tiles.filter(t => {
    if (!t.proposalReady) return false;
    if (t.proposedText.trim() === t.originalText.trim()) return false;
    return true;
  });
}

// ────────────────────────────────────────────────────────────────────
// PipelineStepsIndicator — visible step list inspired by suivitess
// ────────────────────────────────────────────────────────────────────

function PipelineStepsIndicator({
  phase, tiles, selectedCount,
}: {
  phase: Phase;
  tiles: CVAdaptationTile[];
  selectedCount: number;
}) {
  const STEPS: ReadonlyArray<{ key: 'extract' | 'select' | 'adapt' | 'route'; label: string }> = [
    { key: 'extract', label: 'Extraction des sujets atomiques du CV' },
    { key: 'select',  label: 'Sélection par l\'utilisateur des sections à adapter' },
    { key: 'adapt',   label: 'Adaptation à l\'offre par l\'IA (skill B)' },
    { key: 'route',   label: 'Validation tuile par tuile' },
  ];
  const activeIdx =
    phase === 'extracting' ? 0
    : phase === 'selecting' ? 1
    : phase === 'adapting' ? 2
    : 3;

  const ready = tiles.filter(t => t.proposalReady).length;
  const subtitle = phase === 'adapting' && selectedCount > 0
    ? `${ready} / ${selectedCount} tuiles adaptées`
    : phase === 'extracting'
      ? 'Analyse du CV en cours… (~60s pour un CV chargé)'
      : '';

  return (
    <div className="adapt-cv-tiles__pipeline">
      <ul>
        {STEPS.map((step, i) => {
          const status: 'done' | 'active' | 'pending' =
            i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending';
          const marker = status === 'done' ? '✓' : status === 'active' ? '◉' : '○';
          return (
            <li key={step.key} className={`adapt-cv-tiles__pipeline-step adapt-cv-tiles__pipeline-step--${status}`}>
              <span className="adapt-cv-tiles__pipeline-marker">{marker}</span>
              <span>{step.label}</span>
            </li>
          );
        })}
      </ul>
      {subtitle && <p className="adapt-cv-tiles__pipeline-subtitle">{subtitle}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// SelectionPanel — checkbox tree of atomic subjects
// ────────────────────────────────────────────────────────────────────

interface SelectionPanelProps {
  sectionGroups: SectionGroup[];
  selectedTileIds: Set<string>;
  onToggleTile: (tileId: string) => void;
  onToggleGroup: (group: SectionGroup) => void;
  onStart: () => void;
  onCancel: () => void;
  mode: 'classic' | 'aggressive';
  onChangeMode: (m: 'classic' | 'aggressive') => void;
}

function SelectionPanel({
  sectionGroups, selectedTileIds, onToggleTile, onToggleGroup, onStart, onCancel,
  mode, onChangeMode,
}: SelectionPanelProps) {
  const totalSelected = selectedTileIds.size;
  return (
    <div className="adapt-cv-tiles__selection">
      <p className="adapt-cv-tiles__intro">
        Coche les sections que tu veux adapter à l'offre. Décocher une partie évite à l'IA de retravailler ce qui ne t'intéresse pas (et économise des tokens). Tu pourras toujours valider/refuser/modifier chaque proposition après.
      </p>

      {/* Mode picker — surfaced above the section list because it
          changes the AI's overall behaviour, not just one tile. */}
      <fieldset className="adapt-cv-tiles__mode">
        <legend>Mode d'adaptation</legend>
        <label className={`adapt-cv-tiles__mode-option${mode === 'classic' ? ' adapt-cv-tiles__mode-option--selected' : ''}`}>
          <input
            type="radio"
            name="adapt-mode"
            checked={mode === 'classic'}
            onChange={() => onChangeMode('classic')}
          />
          <div>
            <strong>Classique</strong>
            <span>Réécriture fidèle au CV. Synonymes ATS uniquement, aucune compétence ajoutée. À privilégier si tu veux rester strict sur les faits.</span>
          </div>
        </label>
        <label className={`adapt-cv-tiles__mode-option${mode === 'aggressive' ? ' adapt-cv-tiles__mode-option--selected' : ''}`}>
          <input
            type="radio"
            name="adapt-mode"
            checked={mode === 'aggressive'}
            onChange={() => onChangeMode('aggressive')}
          />
          <div>
            <strong>Agressif</strong>
            <span>Réécriture plus offensive (mots-clés, méthodologies, vocabulaire de l'offre) <em>et</em> propose des compétences à <strong>ajouter</strong> au CV — chacune validable individuellement.</span>
          </div>
        </label>
      </fieldset>

      <div className="adapt-cv-tiles__groups">
        {sectionGroups.map(group => {
          const allChecked = group.tiles.every(t => selectedTileIds.has(t.tileId));
          const someChecked = group.tiles.some(t => selectedTileIds.has(t.tileId));
          return (
            <fieldset key={group.key} className="adapt-cv-tiles__group">
              <legend>
                <label className="adapt-cv-tiles__group-toggle">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={el => { if (el) el.indeterminate = !allChecked && someChecked; }}
                    onChange={() => onToggleGroup(group)}
                  />
                  <strong>{group.label}</strong>
                  <span className="adapt-cv-tiles__group-count">
                    {group.tiles.filter(t => selectedTileIds.has(t.tileId)).length} / {group.tiles.length}
                  </span>
                </label>
              </legend>
              <ul>
                {group.tiles.map(t => (
                  <li key={t.tileId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedTileIds.has(t.tileId)}
                        onChange={() => onToggleTile(t.tileId)}
                      />
                      <span className="adapt-cv-tiles__group-item-text">
                        {truncate(t.originalText, 90)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>
      <div className="adapt-cv-tiles__selection-footer">
        <span>
          <strong>{totalSelected}</strong> sujet{totalSelected > 1 ? 's' : ''} sélectionné{totalSelected > 1 ? 's' : ''}
        </span>
        <div className="adapt-cv-tiles__selection-actions">
          <Button variant="secondary" onClick={onCancel}>Annuler</Button>
          <Button
            variant="primary"
            onClick={onStart}
            disabled={totalSelected === 0}
          >
            Lancer l'adaptation IA · mode {mode === 'aggressive' ? 'agressif' : 'classique'} →
          </Button>
        </div>
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}

// ────────────────────────────────────────────────────────────────────
// RoutingTile — original / proposed / reasoning / actions
// ────────────────────────────────────────────────────────────────────

interface RoutingTileProps {
  tile: CVAdaptationTile;
  position: number;
  total: number;
  editingId: string | null;
  editDraft: string;
  busy: boolean;
  onChangeDraft: (s: string) => void;
  onAccept: () => void;
  onSkip: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRevert: () => void;
  onRegenerate: () => void;
}

function RoutingTile({
  tile, position, total,
  editingId, editDraft, busy,
  onChangeDraft, onAccept, onSkip, onStartEdit, onSaveEdit, onCancelEdit, onRevert, onRegenerate,
}: RoutingTileProps) {
  const isEditing = editingId === tile.id;
  const finalText = tile.userEditedText ?? tile.proposedText;
  // Aggressive-mode additions have no `originalText` (they're brand
  // new entries the AI suggests). Don't render the "Avant" section
  // for them — there's nothing to compare against.
  const isAddition = tile.kind.endsWith('_addition');

  return (
    <div className="adapt-cv-tiles__tile">
      {/* Human-readable header so the user knows EXACTLY which CV
          element this tile is — e.g. "France.TV — Mission #1". The
          cryptic JSONPath is shown underneath as a debug hint, not as
          the primary identifier (it confused users who couldn't tell
          which experience a "missions[0]" was attached to). */}
      {tile.label && (
        <div className="adapt-cv-tiles__tile-label">
          {isAddition && <span className="adapt-cv-tiles__addition-badge">+ Ajout suggéré</span>}
          {tile.label}
        </div>
      )}
      <div className="adapt-cv-tiles__progress">
        Modification {position} sur {total} · <code>{tile.kind}</code>
        {!tile.label && <> · <code>{tile.path}</code></>}
      </div>

      {/* Reasoning — surfaced FIRST so the user knows why before
          comparing texts. */}
      {tile.reasoning && (
        <div className="adapt-cv-tiles__reasoning">
          <strong>{isAddition ? 'Pourquoi cet ajout' : 'Pourquoi cette proposition'} :</strong> {tile.reasoning}
        </div>
      )}

      {!isAddition && (
        <section>
          <h4>Avant — texte d'origine</h4>
          <pre className="adapt-cv-tiles__text adapt-cv-tiles__text--original">{tile.originalText || '(vide)'}</pre>
        </section>
      )}

      <section>
        <h4>
          {isAddition ? 'Compétence à ajouter' : 'Après — proposition de l\'IA'}
          {tile.regenerateCount > 0 && <span className="adapt-cv-tiles__hint"> · régénérée {tile.regenerateCount}×</span>}
          {tile.userEditedText !== null && <span className="adapt-cv-tiles__hint"> · modifiée par toi</span>}
        </h4>
        {isEditing ? (
          <textarea
            className="adapt-cv-tiles__edit"
            value={editDraft}
            onChange={e => onChangeDraft(e.target.value)}
            rows={Math.min(12, Math.max(3, editDraft.split('\n').length + 1))}
            autoFocus
          />
        ) : (
          <pre className="adapt-cv-tiles__text adapt-cv-tiles__text--proposed">
            {finalText || '(vide)'}
          </pre>
        )}
      </section>

      <div className="adapt-cv-tiles__actions">
        {isEditing ? (
          <>
            <Button variant="primary" onClick={onSaveEdit} disabled={busy}>
              Enregistrer la modif
            </Button>
            <Button variant="secondary" onClick={onCancelEdit} disabled={busy}>
              Annuler
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" onClick={onAccept} disabled={busy}>
              {isAddition ? '+ Ajouter au CV' : '✓ Je suis d\'accord'}
            </Button>
            <Button variant="secondary" onClick={onSkip} disabled={busy}>
              {isAddition ? '✗ Ne pas ajouter' : '✗ Je ne suis pas d\'accord'}
            </Button>
            <Button variant="secondary" onClick={onStartEdit} disabled={busy}>
              ✎ Modifier
            </Button>
            <Button variant="secondary" onClick={onRegenerate} disabled={busy}>
              {busy ? 'Régénération…' : '🔄 Régénérer'}
            </Button>
            {(tile.userEditedText !== null || tile.regenerateCount > 0) && (
              <Button variant="secondary" onClick={onRevert} disabled={busy}>
                ↺ Revenir à l'original
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
