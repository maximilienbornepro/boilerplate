import { useState, useCallback } from 'react';
import {
  Layout, ModuleHeader, Modal, ConfirmModal, LoadingSpinner,
  Toast, ToastContainer, ListEditor, TagEditor, ExpandableSection,
  ImageUploader, Card, FormField,
  Badge, Button, ProjectEditor,
  SectionTitle, Tabs,
} from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';
import { GanttBoard } from '../roadmap/components/GanttBoard/GanttBoard';
import type { Task as RoadmapTask, Planning, Dependency, ViewMode, Marker } from '../roadmap/types';
import { BoardDelivery } from '../delivery/components/BoardDelivery';
import type { Sprint, Task as DeliveryTask, Release } from '../delivery/types';
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

// ── Mock data for module component demos ────────────────────────────────────

const now = new Date().toISOString();

const mockPlanning: Planning = {
  id: 'demo-1', name: 'Q2 Roadmap', description: 'Planning demo',
  startDate: '2026-03-01', endDate: '2026-06-30',
  createdAt: now, updatedAt: now,
};

const mockRoadmapTasks: RoadmapTask[] = [
  { id: 'rt1', planningId: 'demo-1', parentId: null, name: 'Design System', description: null, startDate: '2026-03-01', endDate: '2026-03-31', color: '#00bcd4', progress: 80, sortOrder: 0, createdAt: now, updatedAt: now },
  { id: 'rt2', planningId: 'demo-1', parentId: null, name: 'API v2', description: null, startDate: '2026-03-15', endDate: '2026-04-30', color: '#8b5cf6', progress: 30, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: 'rt3', planningId: 'demo-1', parentId: null, name: 'Tests E2E', description: null, startDate: '2026-04-15', endDate: '2026-05-15', color: '#4caf50', progress: 0, sortOrder: 2, createdAt: now, updatedAt: now },
  { id: 'rt4', planningId: 'demo-1', parentId: 'rt2', name: 'Auth refactor', description: null, startDate: '2026-03-15', endDate: '2026-04-01', color: '#f59e0b', progress: 60, sortOrder: 0, createdAt: now, updatedAt: now },
];

const mockDependencies: Dependency[] = [
  { id: 'd1', fromTaskId: 'rt1', toTaskId: 'rt3', type: 'finish-to-start', createdAt: now },
];

const mockMarkers: Marker[] = [
  { id: 'm1', planningId: 'demo-1', name: 'Release v2', markerDate: '2026-05-01', color: '#f44336', type: 'milestone', taskId: null, createdAt: now, updatedAt: now },
];

const mockSprints: Sprint[] = [
  { id: 's1', name: 'Sprint 12', startDate: '2026-03-17', endDate: '2026-03-28' },
  { id: 's2', name: 'Sprint 13', startDate: '2026-03-31', endDate: '2026-04-11' },
  { id: 's3', name: 'Sprint 14', startDate: '2026-04-14', endDate: '2026-04-25' },
];

const mockDeliveryTasks: DeliveryTask[] = [
  { id: 'dt1', title: 'Auth refactor', type: 'feature', status: 'in_progress', startCol: 0, endCol: 2, row: 0, storyPoints: 8, estimatedDays: 5, assignee: 'Max', priority: 'high' },
  { id: 'dt2', title: 'Fix login bug', type: 'bug', status: 'done', startCol: 1, endCol: 2, row: 1, storyPoints: 3, estimatedDays: 2, assignee: 'Lea', priority: 'critical' },
  { id: 'dt3', title: 'CI/CD pipeline', type: 'tech', status: 'todo', startCol: 3, endCol: 5, row: 0, storyPoints: 5, estimatedDays: 3, assignee: 'Tom', priority: 'medium' },
  { id: 'dt4', title: 'Release v1.5', type: 'milestone', status: 'todo', startCol: 5, endCol: 6, row: 2 },
];

const mockReleases: Release[] = [
  { id: 'r1', date: '2026-04-25', version: 'v1.5' },
];

function ColorSwatch({ name, desc }: { name: string; desc: string }) {
  return (
    <div className="ds-swatch">
      <div className="ds-swatch-color" style={{ background: `var(${name})` }} />
      <div className="ds-swatch-info">
        <span className="ds-swatch-name">{name}</span>
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

  // Component demo states
  const [listItems, setListItems] = useState(['Premier element', 'Deuxieme element', 'Troisieme element']);
  const [tags, setTags] = useState(['React', 'TypeScript', 'Node.js', 'PostgreSQL']);
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState('tab1');
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState('');
  const [projects, setProjects] = useState([
    { title: 'Projet Alpha', description: 'Refonte du design system' },
    { title: 'Projet Beta', description: 'Migration API v2' },
  ]);

  return (
    <Layout appId="design-system" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader title="Design System" onBack={() => onNavigate?.('/')} />
      <div className="ds-page">

        {/* ══════════════════════════════════════════════════════════════════
            TOKENS
            ══════════════════════════════════════════════════════════════════ */}

        {/* ── Colors ── */}
        <section className="ds-section">
          <SectionTitle>Couleurs</SectionTitle>
          {COLORS.map(group => (
            <div key={group.label} className="ds-color-group">
              <h3 className="ds-group-label">{group.label}</h3>
              <div className="ds-swatches">
                {group.tokens.map(t => <ColorSwatch key={t.name} name={t.name} desc={t.desc} />)}
              </div>
            </div>
          ))}
        </section>

        {/* ── Typography ── */}
        <section className="ds-section">
          <SectionTitle>Typographie</SectionTitle>
          <div className="ds-typo-samples">
            {FONT_SIZES.map(fs => (
              <div key={fs.name} className="ds-typo-row" style={{ fontSize: `var(${fs.name})` }}>
                <span className="ds-typo-label">{fs.label} ({fs.px})</span>
                <span className="ds-typo-sample">The quick brown fox jumps over the lazy dog</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Spacing ── */}
        <section className="ds-section">
          <SectionTitle>Spacing</SectionTitle>
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
          <SectionTitle>Border Radius</SectionTitle>
          <div className="ds-radius-row">
            {RADII.map(r => (
              <div key={r.name} className="ds-radius-item">
                <div className="ds-radius-box" style={{ borderRadius: `var(${r.name})` }} />
                <span className="ds-radius-label">{r.label} ({r.px})</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Shadows ── */}
        <section className="ds-section">
          <SectionTitle>Shadows</SectionTitle>
          <div className="ds-shadow-row">
            {SHADOWS.map(s => (
              <div key={s.name} className="ds-shadow-item">
                <div className="ds-shadow-box" style={{ boxShadow: `var(${s.name})` }} />
                <span className="ds-shadow-label">{s.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            COMPOSANTS SHARED
            ══════════════════════════════════════════════════════════════════ */}

        {/* ── Button ── */}
        <section className="ds-section">
          <SectionTitle>Button</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; Button</p>
          <div className="ds-comp-row">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" disabled>Disabled</Button>
          </div>
        </section>

        {/* ── Badge ── */}
        <section className="ds-section">
          <SectionTitle>Badge</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; Badge</p>
          <div className="ds-comp-row">
            <Badge type="success">Success</Badge>
            <Badge type="warning">Warning</Badge>
            <Badge type="error">Error</Badge>
            <Badge type="info">Info</Badge>
            <Badge type="accent">Accent</Badge>
          </div>
        </section>

        {/* ── SectionTitle ── */}
        <section className="ds-section">
          <SectionTitle>SectionTitle</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; SectionTitle</p>
          <SectionTitle>Exemple de titre de section</SectionTitle>
        </section>

        {/* ── Tabs ── */}
        <section className="ds-section">
          <SectionTitle>Tabs</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; Tabs</p>
          <Tabs
            tabs={[
              { value: 'tab1', label: 'Onglet 1' },
              { value: 'tab2', label: 'Onglet 2' },
              { value: 'tab3', label: 'Onglet 3' },
            ]}
            value={tabValue}
            onChange={setTabValue}
          />
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--spacing-sm)' }}>Onglet actif : {tabValue}</p>
        </section>

        {/* ── Card ── */}
        <section className="ds-section">
          <SectionTitle>Card</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; Card</p>
          <div className="ds-comp-grid">
            <Card>
              <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>Card par defaut</h4>
              <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>Contenu de la carte</p>
            </Card>
            <Card variant="compact">
              <span style={{ color: 'var(--text-primary)', fontSize: 'var(--font-size-sm)' }}>Card compact</span>
            </Card>
            <Card onClick={() => addToast({ type: 'info', message: 'Card cliquee !' })} variant="interactive">
              <h4 style={{ margin: 0, color: 'var(--text-primary)' }}>Card interactive</h4>
              <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)' }}>Cliquez-moi</p>
            </Card>
            <Card selected>
              <h4 style={{ margin: 0, color: 'var(--accent-primary)' }}>Card selectionnee</h4>
            </Card>
          </div>
        </section>

        {/* ── FormField ── */}
        <section className="ds-section">
          <SectionTitle>FormField</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; FormField</p>
          <div className="ds-form-demo">
            <FormField label="Nom" required>
              <input
                type="text"
                value={formName}
                onChange={e => { setFormName(e.target.value); setFormError(e.target.value.length < 3 && e.target.value.length > 0 ? '3 caracteres minimum' : ''); }}
                placeholder="Entrez un nom..."
              />
            </FormField>
            <FormField label="Email">
              <input type="email" placeholder="email@exemple.com" />
            </FormField>
            {formError && (
              <FormField label="Avec erreur" error={formError}>
                <input type="text" value={formName} readOnly />
              </FormField>
            )}
          </div>
        </section>

        {/* ── ListEditor ── */}
        <section className="ds-section">
          <SectionTitle>ListEditor</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; ListEditor</p>
          <div className="ds-comp-constrained">
            <ListEditor items={listItems} onChange={setListItems} label="Missions" placeholder="Ajouter une mission..." />
          </div>
        </section>

        {/* ── TagEditor ── */}
        <section className="ds-section">
          <SectionTitle>TagEditor</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; TagEditor</p>
          <div className="ds-comp-constrained">
            <TagEditor tags={tags} onChange={setTags} label="Technologies" placeholder="Ajouter un tag..." />
          </div>
        </section>

        {/* ── ProjectEditor ── */}
        <section className="ds-section">
          <SectionTitle>ProjectEditor</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; ProjectEditor</p>
          <div className="ds-comp-constrained">
            <ProjectEditor
              label="Projets"
              projects={projects}
              onChange={setProjects}
              placeholder="Titre du projet"
            />
          </div>
        </section>

        {/* ── ExpandableSection ── */}
        <section className="ds-section">
          <SectionTitle>ExpandableSection</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; ExpandableSection</p>
          <div className="ds-comp-constrained">
            <ExpandableSection title="Section depliable" defaultExpanded badge={3}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                Contenu de la section depliable. Le badge affiche un compteur.
              </p>
            </ExpandableSection>
            <ExpandableSection title="Section fermee par defaut">
              <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                Cette section est fermee par defaut.
              </p>
            </ExpandableSection>
          </div>
        </section>

        {/* ── ImageUploader ── */}
        <section className="ds-section">
          <SectionTitle>ImageUploader</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; ImageUploader</p>
          <div className="ds-comp-constrained">
            <ImageUploader image={profileImage || undefined} onChange={setProfileImage} label="Photo de profil" size="medium" />
          </div>
        </section>

        {/* ── LoadingSpinner ── */}
        <section className="ds-section">
          <SectionTitle>LoadingSpinner</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; LoadingSpinner</p>
          <div className="ds-comp-row">
            <LoadingSpinner size="small" />
            <LoadingSpinner />
          </div>
        </section>

        {/* ── Modal / ConfirmModal ── */}
        <section className="ds-section">
          <SectionTitle>Modal / ConfirmModal</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; Modal, ConfirmModal</p>
          <div className="ds-comp-row">
            <Button variant="secondary" onClick={() => setShowModal(true)}>Ouvrir Modal</Button>
            <Button variant="secondary" onClick={() => setShowConfirm(true)}>Ouvrir ConfirmModal</Button>
          </div>
        </section>

        {/* ── Toast ── */}
        <section className="ds-section">
          <SectionTitle>Toast</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; Toast, ToastContainer</p>
          <div className="ds-comp-row">
            <Button variant="secondary" onClick={() => addToast({ type: 'success', message: 'Action réussie !' })}>Success</Button>
            <Button variant="secondary" onClick={() => addToast({ type: 'error', message: 'Une erreur est survenue' })}>Error</Button>
            <Button variant="secondary" onClick={() => addToast({ type: 'info', message: 'Information utile' })}>Info</Button>
            <Button variant="secondary" onClick={() => addToast({ type: 'warning', message: 'Attention requise' })}>Warning</Button>
          </div>
        </section>

        {/* ── ModuleHeader ── */}
        <section className="ds-section">
          <SectionTitle>ModuleHeader</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; ModuleHeader</p>
          <div className="ds-comp-constrained" style={{ border: '1px solid var(--border-color)' }}>
            <ModuleHeader title="Titre du module" subtitle="Sous-titre" onBack={() => addToast({ type: 'info', message: 'Retour clique' })}>
              <Button variant="secondary">Action 1</Button>
              <Button variant="primary">Action 2</Button>
            </ModuleHeader>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            COMPOSANTS MODULES (demos avec mock data)
            ══════════════════════════════════════════════════════════════════ */}

        {/* ── Gantt Board (Roadmap) ── */}
        <section className="ds-section">
          <SectionTitle>GanttBoard (Roadmap)</SectionTitle>
          <p className="ds-component-path">modules/roadmap/components/GanttBoard</p>
          <div className="ds-gantt-demo">
            <GanttBoard
              planning={mockPlanning}
              tasks={mockRoadmapTasks}
              dependencies={mockDependencies}
              viewMode="month"
              markers={mockMarkers}
              onTaskUpdate={() => {}}
              onTaskClick={() => {}}
              onTaskDelete={() => {}}
              onAddTask={() => {}}
              onAddChildTask={() => {}}
              onCreateDependency={() => {}}
              onDeleteDependency={() => {}}
              readOnly
            />
          </div>
        </section>

        {/* ── Delivery Board ── */}
        <section className="ds-section">
          <SectionTitle>BoardDelivery (Delivery)</SectionTitle>
          <p className="ds-component-path">modules/delivery/components/BoardDelivery</p>
          <div className="ds-delivery-demo">
            <BoardDelivery
              sprints={mockSprints}
              tasks={mockDeliveryTasks}
              releases={mockReleases}
              boardLabel="Sprint Board Demo"
              readOnly
              showReleaseMarkers
            />
          </div>
        </section>

      </div>

      {showModal && (
        <Modal title="Exemple de Modal" onClose={() => setShowModal(false)}>
          <p>Contenu de la modal. Composant <code>Modal</code> du design system.</p>
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
