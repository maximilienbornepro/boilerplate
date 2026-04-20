import { useState } from 'react';
import { Button, SectionTitle, LoadingSpinner, ConfirmModal } from '@boilerplate/shared/components';
import * as suiviApi from '../../suivitess/services/api';

// Admin → one-shot cleanup utility that removes legacy `•` bullet
// characters from existing suivitess_subjects.situation values. The AI
// writer skills used to insert those bullets literally, and the editor
// re-renders a bullet on top of them → double bullet (`• •`). Skills
// have been fixed ; this cleans the historical data.

interface Props {
  onToast: (msg: { type: 'success' | 'error' | 'info'; message: string }) => void;
}

type Preview = suiviApi.LegacyBulletCleanupDryRun | null;

export function AdminLegacyBulletsSection({ onToast }: Props) {
  const [preview, setPreview] = useState<Preview>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  const runPreview = async () => {
    setLoading(true);
    try {
      const res = await suiviApi.previewLegacyBulletCleanup();
      setPreview(res);
      onToast({
        type: res.rowsToClean === 0 ? 'success' : 'info',
        message: res.rowsToClean === 0
          ? `Aucun sujet à nettoyer (${res.totalScanned} scannés).`
          : `${res.rowsToClean} sujet(s) à nettoyer sur ${res.totalScanned} scannés.`,
      });
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setLoading(false);
    }
  };

  const runApply = async () => {
    setApplying(true);
    try {
      const res = await suiviApi.applyLegacyBulletCleanup();
      onToast({
        type: 'success',
        message: `✓ ${res.rowsUpdated} sujet(s) nettoyé(s) sur ${res.totalScanned} scannés.`,
      });
      setPreview(null);
      setConfirmApply(false);
    } catch (err) {
      onToast({ type: 'error', message: err instanceof Error ? err.message : 'Erreur' });
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="admin-section" style={{ marginTop: 'var(--spacing-xl)' }}>
      <SectionTitle>Nettoyage des bullets legacy (SuiviTess)</SectionTitle>
      <p className="admin-section-description">
        Les anciens skills IA écrivaient des caractères <code>•</code> en
        début de ligne dans les textes de « situation ». L'éditeur
        SuiviTess dessine lui-même la puce selon l'indentation → double
        bullet visible. Les skills sont corrigés, mais les sujets existants
        dans la base contiennent toujours ces <code>•</code>.
      </p>
      <p className="admin-section-description">
        Ce bouton scanne tous les sujets et propose un aperçu du nettoyage
        (suppression des <code>•</code>/<code>◦</code>/<code>▪</code>/<code>▸</code> en début de ligne,
        conversion des tabulations en espaces). Idempotent — relancer ne
        fait rien sur un sujet déjà propre.
      </p>

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap', marginBottom: 'var(--spacing-md)' }}>
        <Button variant="secondary" onClick={runPreview} disabled={loading || applying}>
          {loading ? 'Analyse…' : '🔍 Prévisualiser'}
        </Button>
        {preview && preview.rowsToClean > 0 && (
          <Button variant="primary" onClick={() => setConfirmApply(true)} disabled={applying}>
            ✂️ Appliquer sur {preview.rowsToClean} sujet{preview.rowsToClean > 1 ? 's' : ''}
          </Button>
        )}
      </div>

      {loading && <LoadingSpinner message="Analyse des situations…" />}

      {preview && (
        <div style={{
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--spacing-md)',
          background: 'var(--bg-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--font-size-sm)',
        }}>
          <div style={{ marginBottom: 'var(--spacing-sm)' }}>
            <strong>Scannés :</strong> {preview.totalScanned} ·{' '}
            <strong>À nettoyer :</strong>{' '}
            <span style={{ color: preview.rowsToClean > 0 ? 'var(--warning, #f59e0b)' : 'var(--success)' }}>
              {preview.rowsToClean}
            </span>
            {preview.truncated && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                (aperçu limité à 500 — toutes seront traitées à l'application)
              </span>
            )}
          </div>

          {preview.rowsToClean === 0 ? (
            <p style={{ color: 'var(--success)', margin: 0 }}>
              ✓ Tous les sujets sont déjà au format propre.
            </p>
          ) : (
            <div style={{
              maxHeight: 400,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--spacing-sm)',
            }}>
              {preview.rows.map(row => (
                <BulletDiffRow key={row.id} row={row} />
              ))}
            </div>
          )}
        </div>
      )}

      {confirmApply && (
        <ConfirmModal
          title="Appliquer le nettoyage ?"
          message={`${preview?.rowsToClean} sujet(s) seront mis à jour en une seule transaction. L'opération est réversible uniquement via un snapshot existant — vérifie que tu as bien un backup récent avant de continuer.`}
          confirmLabel={applying ? 'Application…' : 'Appliquer'}
          onConfirm={runApply}
          onCancel={() => setConfirmApply(false)}
          danger
        />
      )}
    </section>
  );
}

// ── Single row diff renderer ──────────────────────────────────────────

function BulletDiffRow({ row }: { row: suiviApi.LegacyBulletCleanupRow }) {
  return (
    <details style={{
      border: '1px dashed var(--border-color)',
      borderRadius: 'var(--radius-sm)',
      padding: 'var(--spacing-xs) var(--spacing-sm)',
      background: 'var(--bg-primary)',
    }}>
      <summary style={{ cursor: 'pointer' }}>
        <strong>{row.title}</strong>
        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>
          {row.documentTitle} · {row.sectionName}
        </span>
      </summary>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--spacing-sm)',
        marginTop: 'var(--spacing-sm)',
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
            Avant
          </div>
          <pre style={{
            margin: 0,
            padding: 'var(--spacing-xs)',
            background: 'color-mix(in srgb, var(--error) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--error) 30%, var(--border-color))',
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'pre-wrap',
            fontSize: 11,
          }}>{row.before}</pre>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>
            Après
          </div>
          <pre style={{
            margin: 0,
            padding: 'var(--spacing-xs)',
            background: 'color-mix(in srgb, var(--success) 6%, transparent)',
            border: '1px solid color-mix(in srgb, var(--success) 30%, var(--border-color))',
            borderRadius: 'var(--radius-sm)',
            whiteSpace: 'pre-wrap',
            fontSize: 11,
          }}>{row.after}</pre>
        </div>
      </div>
    </details>
  );
}
