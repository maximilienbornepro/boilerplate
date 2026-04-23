/**
 * UX preview sandbox — route `/ux-preview`.
 *
 * Renders `currentPreview.tsx` inside a normal `Layout` so tokens cascade
 * the same way as the real target module. The `appId` query parameter
 * lets the user see the snippet under any module's colour palette :
 *
 *   /ux-preview                → cyan (default, design-system)
 *   /ux-preview?appId=conges   → pink
 *   /ux-preview?appId=roadmap  → violet
 *   /ux-preview?appId=suivitess → green
 *   /ux-preview?appId=delivery → orange
 *
 * This file is OUT OF SCOPE of the `ux-ui-enforcer.sh` hook on purpose :
 * the whole point is to let Claude rewrite `currentPreview.tsx` BEFORE
 * the user grants the ack on the real target module — if the hook
 * blocked this, the preview-first workflow would be impossible.
 */
import { Layout, ModuleHeader } from '@boilerplate/shared/components';
import CurrentPreview from './currentPreview';

const ALLOWED_APP_IDS = ['conges', 'roadmap', 'delivery', 'suivitess', 'design-system'] as const;
type AllowedAppId = (typeof ALLOWED_APP_IDS)[number];

function isAllowedAppId(v: string | null): v is AllowedAppId {
  return v !== null && (ALLOWED_APP_IDS as readonly string[]).includes(v);
}

export default function PreviewSandbox({ onNavigate }: { onNavigate?: (p: string) => void }) {
  // Read `?appId=` so the same preview can be viewed under different module
  // themes. Fallback : design-system (cyan) for a neutral baseline.
  const params = new URLSearchParams(window.location.search);
  const appIdRaw = params.get('appId');
  const appId: AllowedAppId = isAllowedAppId(appIdRaw) ? appIdRaw : 'design-system';

  return (
    <Layout appId={appId} variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader
        title="UX Preview"
        subtitle={`Snippet rendu dans le contexte du module « ${appId} »`}
        onBack={() => onNavigate?.('/')}
      />
      <div style={{ padding: 'var(--spacing-lg)' }}>
        <div
          style={{
            marginBottom: 'var(--spacing-md)',
            padding: 'var(--spacing-sm) var(--spacing-md)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderLeft: '3px solid var(--accent-primary)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--text-primary)' }}>Sandbox de prévisualisation.</strong>{' '}
          Ce rendu est éphémère — il est rempli par le skill <code>ux-ui-guard</code> avant
          chaque validation visuelle, puis réinitialisé une fois le changement appliqué
          dans le module cible.
          <br />
          <span style={{ color: 'var(--text-muted)' }}>
            Changer de palette : ajouter <code>?appId=conges</code>, <code>?appId=roadmap</code>,
            <code>?appId=suivitess</code>, <code>?appId=delivery</code> à l'URL.
          </span>
        </div>

        <div
          style={{
            padding: 'var(--spacing-lg)',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <CurrentPreview />
        </div>
      </div>
    </Layout>
  );
}
