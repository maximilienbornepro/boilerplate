import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, LoadingSpinner } from '@boilerplate/shared/components';
import * as api from '../../services/api';
import type { CVAdaptationTile } from '../../types';
import './AdaptCVTilesModal.css';

interface Props {
  cvId: number;
  jobOffer: string;
  onClose: () => void;
  /** Called once the user has finished walking through every tile.
   *  Passes the resulting adaptation id so the parent can navigate to
   *  the existing AdaptationDetailPage (PDF + edit buttons). */
  onDone: (adaptationId: number) => void;
}

/** Tile-by-tile CV adaptation modal. Forked from
 *  BulkTranscriptionImportModal — same machine d'état (analyzing →
 *  routing → done) but specialized for the CV flow. The tile UI
 *  exposes 5 actions (Valider · Ignorer · Modifier · Annuler les
 *  modifs · Régénérer) per atomic CV element. */
export function AdaptCVTilesModal({ cvId, jobOffer, onClose, onDone }: Props) {
  type Phase = 'analyzing' | 'routing' | 'done' | 'error';
  const [phase, setPhase] = useState<Phase>('analyzing');
  const [adaptationId, setAdaptationId] = useState<number | null>(null);
  const [tiles, setTiles] = useState<CVAdaptationTile[]>([]);
  const [activeTileId, setActiveTileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-tile UI state — kept here (not on the row) because they're
  // ephemeral (textarea visibility, regenerate spinner, save spinner).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<string>('');
  const [busyTileId, setBusyTileId] = useState<string | null>(null);

  // Kick off the adaptation as soon as the modal mounts. Skill A
  // runs synchronously (~60s) and returns the tile list ; skill B
  // runs in the background and fills in the actual AI proposals.
  // The frontend polls /tiles every 4s while at least one tile has
  // proposalReady=false, then stops.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.startTileAdaptation(cvId, jobOffer);
        if (cancelled) return;
        setAdaptationId(res.adaptationId);
        setTiles(res.tiles);
        setActiveTileId(res.tiles[0]?.id ?? null);
        setPhase('routing');
      } catch (err) {
        if (cancelled) return;
        setError((err as Error).message);
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [cvId, jobOffer]);

  // Poll for skill-B updates while we're in routing phase and at
  // least one tile is still awaiting its proposal. Stops as soon as
  // every tile is ready (or the user closes the modal).
  useEffect(() => {
    if (phase !== 'routing' || adaptationId === null) return;
    if (tiles.every(t => t.proposalReady)) return;
    let cancelled = false;
    const intervalId = setInterval(async () => {
      try {
        const fresh = await api.fetchTilesForAdaptation(adaptationId);
        if (cancelled) return;
        setTiles(prev => {
          // Preserve the local UI state machine — only refresh fields
          // that come from skill B (proposed_text + proposal_ready +
          // ai_log_id + regenerate_count). Don't touch user_edited_text
          // / status which the user may have just changed locally.
          const byId = new Map(fresh.map(t => [t.id, t]));
          return prev.map(t => {
            const f = byId.get(t.id);
            if (!f) return t;
            return {
              ...t,
              proposedText: f.proposedText,
              proposalReady: f.proposalReady,
              regenerateCount: f.regenerateCount,
              aiLogId: f.aiLogId,
            };
          });
        });
      } catch { /* swallow — next tick will retry */ }
    }, 4000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [phase, adaptationId, tiles]);

  const pendingTiles = useMemo(() => tiles.filter(t => t.status === 'pending'), [tiles]);
  const activeTile = useMemo(() => tiles.find(t => t.id === activeTileId) ?? null, [tiles, activeTileId]);

  // Pick the next pending tile after a status change. Prefer tiles
  // whose AI proposal is already ready, so the user keeps validating
  // real content while skill B catches up on the rest in the
  // background. Falls back to non-ready tiles only if every ready
  // one has already been treated. Falls through to phase=done when
  // nothing's left.
  const advance = useCallback(() => {
    setEditingId(null);
    setEditDraft('');
    const remaining = tiles.filter(t => t.status === 'pending' && t.id !== activeTileId);
    if (remaining.length === 0) {
      // Last tile committed.
      setPhase('done');
      return;
    }
    const ready = remaining.find(t => t.proposalReady);
    setActiveTileId((ready ?? remaining[0]).id);
  }, [tiles, activeTileId]);

  const replaceTile = (updated: CVAdaptationTile) => {
    setTiles(prev => prev.map(t => (t.id === updated.id ? updated : t)));
  };

  // ── Actions ─────────────────────────────────────────────────────────

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

  /** Drop the user's edits AND any ongoing regeneration : the
   *  proposal goes back to the AI's last suggestion. If the user
   *  already accepted/edited the tile in DB, this PUT also rewrites
   *  the merged text in `adapted_cv` (server-side merge). */
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
      // Clear any in-flight edit so the new proposal is what's displayed.
      setEditingId(null);
      setEditDraft('');
    } catch (err) { setError((err as Error).message); }
    finally { setBusyTileId(null); }
  };

  // ── Render ──────────────────────────────────────────────────────────

  const headerTitle = phase === 'analyzing'
    ? 'Analyse du CV en cours…'
    : phase === 'done'
      ? 'Adaptation terminée'
      : 'Adapter le CV à l\'offre';

  return (
    <Modal isOpen={true} onClose={onClose} title={headerTitle}>
      <div className="adapt-cv-tiles">
        {error && <div className="adapt-cv-tiles__error">⚠ {error}</div>}

        {phase === 'analyzing' && (
          <div className="adapt-cv-tiles__loading">
            <LoadingSpinner size="lg" />
            <p>L'IA extrait les sujets atomiques du CV puis propose une adaptation pour chaque élément. Patience, ça peut prendre 20-40 secondes.</p>
          </div>
        )}

        {phase === 'routing' && activeTile && (
          <RoutingTile
            tile={activeTile}
            position={tiles.findIndex(t => t.id === activeTile.id) + 1}
            total={tiles.length}
            pendingCount={pendingTiles.length}
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

        {phase === 'done' && adaptationId !== null && (
          <div className="adapt-cv-tiles__done">
            <p>Toutes les tuiles ont été traitées. Tu peux maintenant télécharger le CV adapté en PDF ou continuer à le modifier dans l'éditeur.</p>
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
            <p className="adapt-cv-tiles__error-msg">⚠ Une erreur s'est produite. {error}</p>
            <Button variant="secondary" onClick={onClose}>Fermer</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────
// RoutingTile — the per-tile UI : original / proposal / actions
// ────────────────────────────────────────────────────────────────────

interface RoutingTileProps {
  tile: CVAdaptationTile;
  position: number;
  total: number;
  pendingCount: number;
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
  tile, position, total, pendingCount,
  editingId, editDraft, busy,
  onChangeDraft, onAccept, onSkip, onStartEdit, onSaveEdit, onCancelEdit, onRevert, onRegenerate,
}: RoutingTileProps) {
  const isEditing = editingId === tile.id;
  const proposalUnchanged = tile.proposedText.trim() === tile.originalText.trim();

  return (
    <div className="adapt-cv-tiles__tile">
      <div className="adapt-cv-tiles__progress">
        Tuile {position} sur {total} · {pendingCount} en attente · type : <code>{tile.kind}</code>
      </div>

      <section>
        <h4>Texte d'origine</h4>
        <pre className="adapt-cv-tiles__text adapt-cv-tiles__text--original">{tile.originalText || '(vide)'}</pre>
      </section>

      <section>
        <h4>
          Proposition de l'IA
          {!tile.proposalReady && <span className="adapt-cv-tiles__hint"> · 📡 IA en cours…</span>}
          {tile.proposalReady && proposalUnchanged && <span className="adapt-cv-tiles__hint"> · identique à l'original</span>}
          {tile.regenerateCount > 0 && <span className="adapt-cv-tiles__hint"> · régénérée {tile.regenerateCount}×</span>}
        </h4>
        {isEditing ? (
          <textarea
            className="adapt-cv-tiles__edit"
            value={editDraft}
            onChange={e => onChangeDraft(e.target.value)}
            rows={Math.min(12, Math.max(3, editDraft.split('\n').length + 1))}
            autoFocus
          />
        ) : !tile.proposalReady ? (
          <pre className="adapt-cv-tiles__text adapt-cv-tiles__text--pending">
            La proposition adaptée à l'offre arrive dans quelques secondes…
          </pre>
        ) : (
          <pre className="adapt-cv-tiles__text adapt-cv-tiles__text--proposed">
            {(tile.userEditedText ?? tile.proposedText) || '(vide)'}
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
            {/* Valider et Régénérer ne servent à rien tant que skill B
                n'a pas écrit la proposition (sinon on commit l'original
                comme s'il était la proposition IA). On les désactive et
                on l'explique dans le tooltip / hint. Ignorer et
                Modifier restent dispo pour avancer. */}
            <Button
              variant="primary"
              onClick={onAccept}
              disabled={busy || !tile.proposalReady}
              title={!tile.proposalReady ? 'En attente de la proposition IA' : undefined}
            >
              ✓ Valider
            </Button>
            <Button variant="secondary" onClick={onSkip} disabled={busy}>
              ⏭ Ignorer
            </Button>
            <Button variant="secondary" onClick={onStartEdit} disabled={busy}>
              ✎ Modifier
            </Button>
            <Button
              variant="secondary"
              onClick={onRegenerate}
              disabled={busy || !tile.proposalReady}
              title={!tile.proposalReady ? 'La proposition n\'est pas encore générée' : undefined}
            >
              {busy ? 'Régénération…' : '🔄 Régénérer'}
            </Button>
            {(tile.userEditedText !== null || tile.regenerateCount > 0) && (
              <Button variant="secondary" onClick={onRevert} disabled={busy}>
                ↺ Annuler les modifs
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
