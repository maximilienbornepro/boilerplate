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

  // Kick off the adaptation as soon as the modal mounts.
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

  const pendingTiles = useMemo(() => tiles.filter(t => t.status === 'pending'), [tiles]);
  const activeTile = useMemo(() => tiles.find(t => t.id === activeTileId) ?? null, [tiles, activeTileId]);

  // Pick the next pending tile after a status change. Falls through
  // to phase=done when nothing's left.
  const advance = useCallback(() => {
    setEditingId(null);
    setEditDraft('');
    const next = tiles.find(t => t.status === 'pending' && t.id !== activeTileId);
    if (next) {
      setActiveTileId(next.id);
    } else {
      setPhase('done');
    }
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
          {proposalUnchanged && <span className="adapt-cv-tiles__hint"> · identique à l'original</span>}
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
            <Button variant="primary" onClick={onAccept} disabled={busy}>
              ✓ Valider
            </Button>
            <Button variant="secondary" onClick={onSkip} disabled={busy}>
              ⏭ Ignorer
            </Button>
            <Button variant="secondary" onClick={onStartEdit} disabled={busy}>
              ✎ Modifier
            </Button>
            <Button variant="secondary" onClick={onRegenerate} disabled={busy}>
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
