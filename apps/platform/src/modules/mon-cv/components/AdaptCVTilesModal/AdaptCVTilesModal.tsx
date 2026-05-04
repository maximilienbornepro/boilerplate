import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { CVAdaptationTile } from '../../types';
import './AdaptCVTilesModal.css';

interface Props {
  cvId: number;
  jobOffer: string;
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
export function AdaptCVTilesModal({ cvId, jobOffer, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('extracting');
  const [adaptationId, setAdaptationId] = useState<number | null>(null);
  const [tiles, setTiles] = useState<CVAdaptationTile[]>([]);
  const [selectedTileIds, setSelectedTileIds] = useState<Set<string>>(new Set());
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-tile UI state.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');
  const [busyTileId, setBusyTileId] = useState<string | null>(null);

  // ── 1. Extract atomics on mount ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
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
  }, [cvId, jobOffer]);

  // ── 3. Poll /tiles while skill B is running ─────────────────────────
  useEffect(() => {
    if (phase !== 'adapting' && phase !== 'routing') return;
    if (adaptationId === null) return;
    if (tiles.every(t => t.proposalReady)) {
      // First time we discover everything is ready : flip from
      // 'adapting' to 'routing'. From within 'routing' we just stop
      // polling silently.
      if (phase === 'adapting') setPhase('routing');
      return;
    }
    let cancelled = false;
    const intervalId = setInterval(async () => {
      try {
        const fresh = await api.fetchTilesForAdaptation(adaptationId);
        if (cancelled) return;
        setTiles(prev => {
          const byId = new Map(fresh.map(t => [t.id, t]));
          return prev.map(t => {
            const f = byId.get(t.id);
            if (!f) return t;
            // Preserve user-edited fields ; only sync the skill-B
            // outputs.
            return {
              ...t,
              proposedText: f.proposedText,
              proposalReady: f.proposalReady,
              reasoning: f.reasoning,
              regenerateCount: f.regenerateCount,
              aiLogId: f.aiLogId,
            };
          });
        });
      } catch { /* swallow ; next tick retries */ }
    }, 4000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [phase, adaptationId, tiles]);

  // Once we transition to 'routing', set the first ready & modified
  // tile as the active one.
  useEffect(() => {
    if (phase !== 'routing' || activeTileId !== null) return;
    const first = visibleModifiedTiles(tiles)[0];
    if (first) setActiveTileId(first.id);
    else setPhase('done'); // skill B didn't modify anything
  }, [phase, activeTileId, tiles]);

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
      await api.runAdaptOnSelected(adaptationId, Array.from(selectedTileIds));
    } catch (err) {
      setError((err as Error).message);
      setPhase('error');
    }
  };

  // ── 4. Routing actions ──────────────────────────────────────────────
  const visibleTiles = useMemo(() => visibleModifiedTiles(tiles), [tiles]);
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
      const updated = await api.regenerateTile(adaptationId, activeTile.id);
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
    <Modal isOpen={true} onClose={onClose} title={headerTitle}>
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
    // experiences[i].xxx → group by experience index
    const expMatch = t.path.match(/^experiences\[(\d+)\]/);
    if (expMatch) {
      const idx = expMatch[1];
      ensure(`experience-${idx}`, `Expérience #${parseInt(idx, 10) + 1}`).tiles.push(t);
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
}

function SelectionPanel({
  sectionGroups, selectedTileIds, onToggleTile, onToggleGroup, onStart, onCancel,
}: SelectionPanelProps) {
  const totalSelected = selectedTileIds.size;
  return (
    <div className="adapt-cv-tiles__selection">
      <p className="adapt-cv-tiles__intro">
        Coche les sections que tu veux adapter à l'offre. Décocher une partie évite à l'IA de retravailler ce qui ne t'intéresse pas (et économise des tokens). Tu pourras toujours valider/refuser/modifier chaque proposition après.
      </p>
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
            Lancer l'adaptation IA →
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

  return (
    <div className="adapt-cv-tiles__tile">
      <div className="adapt-cv-tiles__progress">
        Modification {position} sur {total} · <code>{tile.kind}</code> · <code>{tile.path}</code>
      </div>

      {/* Reasoning — surfaced FIRST so the user knows why before
          comparing texts. */}
      {tile.reasoning && (
        <div className="adapt-cv-tiles__reasoning">
          <strong>Pourquoi cette proposition :</strong> {tile.reasoning}
        </div>
      )}

      <section>
        <h4>Avant — texte d'origine</h4>
        <pre className="adapt-cv-tiles__text adapt-cv-tiles__text--original">{tile.originalText || '(vide)'}</pre>
      </section>

      <section>
        <h4>
          Après — proposition de l'IA
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
              ✓ Je suis d'accord
            </Button>
            <Button variant="secondary" onClick={onSkip} disabled={busy}>
              ✗ Je ne suis pas d'accord
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
