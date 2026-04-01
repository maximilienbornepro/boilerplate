import { useState, useCallback } from 'react';
import { Layout, ModuleHeader, Modal, ConfirmModal, LoadingSpinner, Toast, ToastContainer } from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import './App.css';

// ── Token data ──────────────────────────────────────────────────────────────

const COLORS = [
  { label: 'Backgrounds', tokens: [
    { name: '--bg-primary', desc: 'Fond principal' },
    { name: '--bg-secondary', desc: 'Fond secondaire' },
    { name: '--bg-tertiary', desc: 'Fond tertiaire' },
    { name: '--bg-card', desc: 'Fond carte' },
    { name: '--bg-input', desc: 'Fond input' },
    { name: '--bg-hover', desc: 'Fond hover' },
  ]},
  { label: 'Text', tokens: [
    { name: '--text-primary', desc: 'Texte principal' },
    { name: '--text-secondary', desc: 'Texte secondaire' },
    { name: '--text-muted', desc: 'Texte discret' },
    { name: '--text-light', desc: 'Texte leger' },
    { name: '--text-inverse', desc: 'Texte inverse' },
  ]},
  { label: 'Accent', tokens: [
    { name: '--accent-primary', desc: 'Accent principal (cyan)' },
    { name: '--accent-primary-hover', desc: 'Accent hover' },
    { name: '--accent-secondary', desc: 'Accent secondaire' },
    { name: '--accent-light', desc: 'Accent fond' },
  ]},
  { label: 'Borders', tokens: [
    { name: '--border-color', desc: 'Bordure standard' },
    { name: '--border-light', desc: 'Bordure legere' },
  ]},
  { label: 'Status', tokens: [
    { name: '--success', desc: 'Succes' },
    { name: '--warning', desc: 'Warning' },
    { name: '--error', desc: 'Erreur' },
    { name: '--info', desc: 'Info' },
  ]},
];

const FONT_SIZES = [
  { name: '--font-size-xs', label: 'XS', px: '11px' },
  { name: '--font-size-sm', label: 'SM', px: '12px' },
  { name: '--font-size-base', label: 'Base', px: '13px' },
  { name: '--font-size-md', label: 'MD', px: '14px' },
  { name: '--font-size-lg', label: 'LG', px: '16px' },
  { name: '--font-size-xl', label: 'XL', px: '18px' },
  { name: '--font-size-2xl', label: '2XL', px: '20px' },
  { name: '--font-size-3xl', label: '3XL', px: '24px' },
];

const SPACINGS = [
  { name: '--spacing-2xs', label: '2XS', px: '2px' },
  { name: '--spacing-xs', label: 'XS', px: '4px' },
  { name: '--spacing-sm', label: 'SM', px: '8px' },
  { name: '--spacing-md', label: 'MD', px: '12px' },
  { name: '--spacing-lg', label: 'LG', px: '16px' },
  { name: '--spacing-xl', label: 'XL', px: '24px' },
  { name: '--spacing-2xl', label: '2XL', px: '32px' },
  { name: '--spacing-3xl', label: '3XL', px: '48px' },
];

const RADII = [
  { name: '--radius-xs', label: 'XS', px: '1px' },
  { name: '--radius-sm', label: 'SM', px: '2px' },
  { name: '--radius-md', label: 'MD', px: '3px' },
  { name: '--radius-lg', label: 'LG', px: '4px' },
  { name: '--radius-full', label: 'Full', px: '4px' },
];

const SHADOWS = [
  { name: '--shadow-xs', label: 'XS' },
  { name: '--shadow-sm', label: 'SM' },
  { name: '--shadow-md', label: 'MD' },
  { name: '--shadow-focus', label: 'Focus' },
  { name: '--shadow-accent-md', label: 'Accent' },
  { name: '--shadow-success-md', label: 'Success' },
];

function getComputedToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ColorSwatch({ name, desc }: { name: string; desc: string }) {
  const value = getComputedToken(name);
  return (
    <div className="ds-swatch">
      <div className="ds-swatch-color" style={{ background: `var(${name})` }} />
      <div className="ds-swatch-info">
        <span className="ds-swatch-name">{name}</span>
        <span className="ds-swatch-value">{value}</span>
        <span className="ds-swatch-desc">{desc}</span>
      </div>
    </div>
  );
}

function DesignSystemPage({ onNavigate }: { onNavigate?: (path: string) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000);
  }, []);
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <Layout appId="design-system" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader title="Design System" />
      <div className="ds-page">

        {/* ── Colors ── */}
        <section className="ds-section">
          <h2 className="ds-section-title">Couleurs</h2>
          {COLORS.map(group => (
            <div key={group.label} className="ds-color-group">
              <h3 className="ds-group-label">{group.label}</h3>
              <div className="ds-swatches">
                {group.tokens.map(t => (
                  <ColorSwatch key={t.name} name={t.name} desc={t.desc} />
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* ── Typography ── */}
        <section className="ds-section">
          <h2 className="ds-section-title">Typographie</h2>
          <div className="ds-typo-info">
            <span className="ds-token">--font-family-mono</span>
            <span className="ds-value">SF Mono, Fira Code, Cascadia Code, JetBrains Mono, Consolas</span>
          </div>
          <div className="ds-typo-samples">
            {FONT_SIZES.map(fs => (
              <div key={fs.name} className="ds-typo-row" style={{ fontSize: `var(${fs.name})` }}>
                <span className="ds-typo-label">{fs.label} ({fs.px})</span>
                <span className="ds-typo-sample">The quick brown fox jumps over the lazy dog</span>
                <span className="ds-typo-token">{fs.name}</span>
              </div>
            ))}
          </div>
          <div className="ds-typo-weights">
            <span style={{ fontWeight: 400 }}>Normal (400)</span>
            <span style={{ fontWeight: 500 }}>Medium (500)</span>
            <span style={{ fontWeight: 600 }}>Semibold (600)</span>
            <span style={{ fontWeight: 700 }}>Bold (700)</span>
          </div>
        </section>

        {/* ── Spacing ── */}
        <section className="ds-section">
          <h2 className="ds-section-title">Spacing</h2>
          <div className="ds-spacing-rows">
            {SPACINGS.map(sp => (
              <div key={sp.name} className="ds-spacing-row">
                <span className="ds-spacing-label">{sp.label} ({sp.px})</span>
                <div className="ds-spacing-bar" style={{ width: `var(${sp.name})` }} />
                <span className="ds-spacing-token">{sp.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Radius ── */}
        <section className="ds-section">
          <h2 className="ds-section-title">Border Radius</h2>
          <div className="ds-radius-row">
            {RADII.map(r => (
              <div key={r.name} className="ds-radius-item">
                <div className="ds-radius-box" style={{ borderRadius: `var(${r.name})` }} />
                <span className="ds-radius-label">{r.label} ({r.px})</span>
                <span className="ds-radius-token">{r.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Shadows ── */}
        <section className="ds-section">
          <h2 className="ds-section-title">Shadows</h2>
          <div className="ds-shadow-row">
            {SHADOWS.map(s => (
              <div key={s.name} className="ds-shadow-item">
                <div className="ds-shadow-box" style={{ boxShadow: `var(${s.name})` }} />
                <span className="ds-shadow-label">{s.label}</span>
                <span className="ds-shadow-token">{s.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Components ── */}
        <section className="ds-section">
          <h2 className="ds-section-title">Composants</h2>

          <div className="ds-comp-group">
            <h3 className="ds-group-label">Buttons</h3>
            <div className="ds-comp-row">
              <button className="module-header-btn module-header-btn-primary">Primary</button>
              <button className="module-header-btn">Secondary</button>
              <button className="module-header-btn" disabled>Disabled</button>
            </div>
          </div>

          <div className="ds-comp-group">
            <h3 className="ds-group-label">LoadingSpinner</h3>
            <div className="ds-comp-row">
              <LoadingSpinner size="small" />
              <LoadingSpinner />
            </div>
          </div>

          <div className="ds-comp-group">
            <h3 className="ds-group-label">Modal</h3>
            <div className="ds-comp-row">
              <button className="module-header-btn" onClick={() => setShowModal(true)}>Ouvrir Modal</button>
              <button className="module-header-btn" onClick={() => setShowConfirm(true)}>Ouvrir ConfirmModal</button>
            </div>
          </div>

          <div className="ds-comp-group">
            <h3 className="ds-group-label">Toast</h3>
            <div className="ds-comp-row">
              <button className="module-header-btn" onClick={() => addToast({ type: 'success', message: 'Action reussie !' })}>Success</button>
              <button className="module-header-btn" onClick={() => addToast({ type: 'error', message: 'Une erreur est survenue' })}>Error</button>
              <button className="module-header-btn" onClick={() => addToast({ type: 'info', message: 'Information utile' })}>Info</button>
            </div>
          </div>

          <div className="ds-comp-group">
            <h3 className="ds-group-label">Status badges</h3>
            <div className="ds-comp-row">
              <span className="ds-badge ds-badge--success">Success</span>
              <span className="ds-badge ds-badge--warning">Warning</span>
              <span className="ds-badge ds-badge--error">Error</span>
              <span className="ds-badge ds-badge--info">Info</span>
              <span className="ds-badge ds-badge--accent">Accent</span>
            </div>
          </div>
        </section>

      </div>

      {showModal && (
        <Modal title="Exemple de Modal" onClose={() => setShowModal(false)}>
          <p>Contenu de la modal. Utilise le composant <code>Modal</code> du design system.</p>
        </Modal>
      )}

      {showConfirm && (
        <ConfirmModal
          title="Confirmer l'action"
          message="Etes-vous sur de vouloir continuer ?"
          onConfirm={() => { setShowConfirm(false); addToast({ type: 'success', message: 'Confirme !' }); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </Layout>
  );
}

export default function DesignSystemApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return <DesignSystemPage onNavigate={onNavigate} />;
}
