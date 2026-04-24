/**
 * Design System page.
 *
 * DATA-DRIVEN : all usage statistics (which shared components are used,
 * by which modules, and all local components per module) come from
 * `design-system.data.json` at the repo root. That file is auto-generated
 * by `npm run audit:components` — running the audit refreshes the page
 * content without any manual edit here.
 *
 * Scope of the audit : Landing + Roadmap + Congés + Delivery + SuiviTess.
 * Anything rendered outside these 5 modules does not feed the usage stats,
 * by design — the DS is meant to reflect what we actually ship.
 */
import { useState, useCallback, type ReactNode, type CSSProperties } from 'react';
import {
  Layout, ModuleHeader, Modal, ModalBody, ModalActions, ConfirmModal, LoadingSpinner,
  ToastContainer, ExpandableSection, Card, FormField,
  Badge, Button,
  Tabs,
  SharingModal, VisibilityPicker,
  ViewSelector, Legend, EmptyState, StatusTag,
  APPS,
} from '@boilerplate/shared/components';
import type { ViewModeOption } from '@boilerplate/shared/components';
import { STATUS_OPTIONS } from '../suivitess/types';
import type { ToastData, Visibility, ProjectItem } from '@boilerplate/shared/components';
import { GanttBoard } from '../roadmap/components/GanttBoard/GanttBoard';
import type { Task as RoadmapTask, Planning, Dependency, ViewMode, Marker } from '../roadmap/types';
import { BoardDelivery } from '../delivery/components/BoardDelivery';
import type { Sprint, Task as DeliveryTask, Release } from '../delivery/types';
// Local component demos — heavy components get a typed preview card
// (see TYPE_OF_LOCAL map below) instead of a full live render, because
// most of them need context, auth, or backend data.

/** Visual type of a local component — drives the preview icon + style. */
type LocalKind = 'modal' | 'form' | 'panel' | 'widget' | 'board' | 'list' | 'toolbar' | 'marker';

/** Hand-curated classification of local components by visual type.
 *  Fallback to 'widget' for anything not listed. */
const LOCAL_KIND: Record<string, LocalKind> = {
  // Modals (overlay, focused task)
  LeaveForm: 'modal',
  TaskForm: 'modal',
  ImportModal: 'modal',
  JiraImportModal: 'modal',
  RestoreModal: 'modal',
  SnapshotModal: 'modal',
  SanityCheckModal: 'modal',
  LayoutRulesModal: 'modal',
  EmailPreviewModal: 'modal',
  BulkTranscriptionImportModal: 'modal',
  TicketCreateModal: 'modal',
  SubjectAnalysisModal: 'modal',
  HistoryPanel: 'modal',

  // Boards (large complex grid)
  GanttBoard: 'board',
  BoardDelivery: 'board',
  LeaveCalendar: 'board',

  // Lists / navigation
  PlanningList: 'list',
  BoardList: 'list',
  TableOfContents: 'list',
  DocumentSelector: 'list',

  // Side panels
  SubjectsPanel: 'panel',
  SuggestionsPanel: 'panel',
  Preview: 'panel',
  SubjectReview: 'panel',
  ReviewWizard: 'panel',

  // Toolbars / controls
  RecorderBar: 'toolbar',
  SkillButton: 'toolbar',

  // Visual markers on boards
  TodayMarker: 'marker',
  ReleaseMarker: 'marker',

  // Row-level
  BoardRow: 'widget',
  SprintColumn: 'widget',
  TaskBlock: 'widget',
};

/** Mini wireframe per local component name — static HTML/CSS mockup that
 *  approximates the visual structure without importing the real component.
 *  Fallback to a generic kind-based wireframe when no specific mock exists. */
function LocalWireframe({ name, kind, color }: { name: string; kind: LocalKind; color: string }) {
  const acc = color;
  const bg = `color-mix(in srgb, ${acc} 10%, transparent)`;
  const border = `color-mix(in srgb, ${acc} 40%, var(--border-color))`;
  const line = 'var(--border-color)';
  const muted = 'var(--text-muted)';

  // ── Module-specific wireframes ─────────────────────────────────────
  switch (name) {
    case 'LeaveForm':
      return (
        <div className="ds-wf ds-wf--modal">
          <div className="ds-wf-bar" style={{ background: bg, borderColor: border }}>Poser un congé <span style={{ marginLeft: 'auto' }}>×</span></div>
          <div className="ds-wf-field" style={{ borderColor: line }}>Date de début</div>
          <div className="ds-wf-field" style={{ borderColor: line }}>Date de fin</div>
          <div className="ds-wf-field" style={{ borderColor: line }}>Motif ▾</div>
          <div className="ds-wf-actions">
            <span className="ds-wf-btn" style={{ borderColor: line }}>Annuler</span>
            <span className="ds-wf-btn ds-wf-btn--primary" style={{ background: acc, borderColor: acc }}>Valider</span>
          </div>
        </div>
      );
    case 'LeaveCalendar':
      return (
        <div className="ds-wf ds-wf--board">
          <div className="ds-wf-row ds-wf-header" style={{ color: muted }}>
            <span>Membre</span><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span>
          </div>
          {[0, 1, 2].map(i => (
            <div key={i} className="ds-wf-row">
              <span className="ds-wf-cell-name">Membre {i + 1}</span>
              <span /><span className="ds-wf-cell-filled" style={{ background: acc }} /><span className="ds-wf-cell-filled" style={{ background: acc }} /><span /><span />
            </div>
          ))}
        </div>
      );
    case 'GanttBoard':
      return (
        <div className="ds-wf ds-wf--board">
          <div className="ds-wf-row ds-wf-header" style={{ color: muted }}><span>Tâche</span><span>Jan</span><span>Fév</span><span>Mar</span><span>Avr</span></div>
          {[[0, 2], [1, 3], [2, 4]].map(([s, e], i) => (
            <div key={i} className="ds-wf-row">
              <span className="ds-wf-cell-name">Tâche {i + 1}</span>
              {[0, 1, 2, 3].map(col => (
                <span key={col} className={col >= s && col < e ? 'ds-wf-cell-filled' : ''} style={col >= s && col < e ? { background: acc } : undefined} />
              ))}
            </div>
          ))}
        </div>
      );
    case 'TaskForm':
      return (
        <div className="ds-wf ds-wf--modal">
          <div className="ds-wf-bar" style={{ background: bg, borderColor: border }}>Nouvelle tâche <span style={{ marginLeft: 'auto' }}>×</span></div>
          <div className="ds-wf-field" style={{ borderColor: line }}>Nom</div>
          <div className="ds-wf-field" style={{ borderColor: line }}>Sujets SuiviTess liés</div>
          <div className="ds-wf-actions">
            <span className="ds-wf-btn" style={{ borderColor: line }}>Annuler</span>
            <span className="ds-wf-btn ds-wf-btn--primary" style={{ background: acc, borderColor: acc }}>Créer</span>
          </div>
        </div>
      );
    case 'PlanningList':
    case 'BoardList':
      return (
        <div className="ds-wf ds-wf--list">
          {[1, 2, 3].map(i => (
            <div key={i} className="ds-wf-row" style={{ borderColor: line }}>
              <span className="ds-wf-dot" style={{ background: acc }} />
              <span className="ds-wf-cell-name">Élément {i}</span>
              <span style={{ color: muted, marginLeft: 'auto' }}>›</span>
            </div>
          ))}
        </div>
      );
    case 'SubjectsPanel':
    case 'SuggestionsPanel':
      return (
        <div className="ds-wf ds-wf--panel">
          <div className="ds-wf-bar" style={{ background: bg, borderColor: border }}>Panneau</div>
          <div className="ds-wf-row"><span className="ds-wf-dot" style={{ background: acc }} />Item 1</div>
          <div className="ds-wf-row"><span className="ds-wf-dot" style={{ background: acc }} />Item 2</div>
          <div className="ds-wf-row"><span className="ds-wf-dot" style={{ background: acc }} />Item 3</div>
        </div>
      );
    case 'BoardDelivery':
      return (
        <div className="ds-wf ds-wf--board">
          <div className="ds-wf-row ds-wf-header" style={{ color: muted }}><span>S1</span><span>S2</span><span>S3</span><span>S4</span></div>
          {[0, 1].map(i => (
            <div key={i} className="ds-wf-row">
              <span className="ds-wf-cell-filled" style={{ background: acc }} />
              <span className="ds-wf-cell-filled" style={{ background: acc }} />
              <span />
              <span className="ds-wf-cell-filled" style={{ background: acc }} />
            </div>
          ))}
        </div>
      );
    case 'TaskBlock':
      return (
        <div className="ds-wf ds-wf--widget">
          <div className="ds-wf-card" style={{ borderColor: border, background: bg }}>
            <div style={{ fontSize: 10, color: muted }}>TASK-123</div>
            <div style={{ fontWeight: 600 }}>Intégration API</div>
          </div>
        </div>
      );
    case 'ReleaseMarker':
    case 'TodayMarker':
      return (
        <div className="ds-wf ds-wf--marker">
          <div className="ds-wf-marker-line" style={{ background: acc }}>
            <span className="ds-wf-marker-label" style={{ background: acc }}>{name === 'TodayMarker' ? 'Aujourd\'hui' : 'v1.2.0'}</span>
          </div>
        </div>
      );
    case 'SprintColumn':
      return (
        <div className="ds-wf ds-wf--list">
          <div className="ds-wf-bar" style={{ background: bg, borderColor: border }}>Sprint 3</div>
          <div className="ds-wf-row" style={{ borderColor: line }}><span className="ds-wf-dot" style={{ background: acc }} />TVS-1</div>
          <div className="ds-wf-row" style={{ borderColor: line }}><span className="ds-wf-dot" style={{ background: acc }} />TVS-2</div>
        </div>
      );
    case 'BoardRow':
      return (
        <div className="ds-wf ds-wf--widget">
          <div className="ds-wf-row" style={{ borderColor: line }}>
            <span className="ds-wf-cell-name">Ligne</span>
            <span className="ds-wf-cell-filled" style={{ background: acc, flex: 1 }} />
          </div>
        </div>
      );
    case 'ImportModal':
    case 'JiraImportModal':
    case 'RestoreModal':
    case 'SnapshotModal':
    case 'SanityCheckModal':
    case 'LayoutRulesModal':
    case 'EmailPreviewModal':
    case 'BulkTranscriptionImportModal':
    case 'TicketCreateModal':
    case 'SubjectAnalysisModal':
    case 'HistoryPanel':
      return (
        <div className="ds-wf ds-wf--modal">
          <div className="ds-wf-bar" style={{ background: bg, borderColor: border }}>{name.replace(/Modal|Panel/g, '')} <span style={{ marginLeft: 'auto' }}>×</span></div>
          <div className="ds-wf-field" style={{ borderColor: line }}>Contenu</div>
          <div className="ds-wf-field" style={{ borderColor: line }}>Contenu</div>
          <div className="ds-wf-actions">
            <span className="ds-wf-btn" style={{ borderColor: line }}>Annuler</span>
            <span className="ds-wf-btn ds-wf-btn--primary" style={{ background: acc, borderColor: acc }}>Valider</span>
          </div>
        </div>
      );
    case 'TableOfContents':
      return (
        <div className="ds-wf ds-wf--list">
          <div className="ds-wf-row" style={{ borderColor: line }}><span className="ds-wf-dot" style={{ background: acc }} />Section 1</div>
          <div className="ds-wf-row" style={{ borderColor: line, paddingLeft: 20 }}><span className="ds-wf-dot" style={{ background: acc, opacity: 0.6 }} />Sujet A</div>
          <div className="ds-wf-row" style={{ borderColor: line, paddingLeft: 20 }}><span className="ds-wf-dot" style={{ background: acc, opacity: 0.6 }} />Sujet B</div>
        </div>
      );
    case 'DocumentSelector':
      return (
        <div className="ds-wf ds-wf--list">
          <div className="ds-wf-bar" style={{ background: bg, borderColor: border }}>Sélectionner un document ▾</div>
          <div className="ds-wf-row" style={{ borderColor: line }}><span className="ds-wf-dot" style={{ background: acc }} />Suivi Hebdo TV</div>
          <div className="ds-wf-row" style={{ borderColor: line }}><span className="ds-wf-dot" style={{ background: acc }} />Copil Amazon</div>
        </div>
      );
    case 'Preview':
    case 'SubjectReview':
    case 'ReviewWizard':
      return (
        <div className="ds-wf ds-wf--panel">
          <div className="ds-wf-bar" style={{ background: bg, borderColor: border }}>{name}</div>
          <div className="ds-wf-field" style={{ borderColor: line }}>Titre du sujet</div>
          <div className="ds-wf-row"><span className="ds-wf-dot" style={{ background: acc }} />• Point 1</div>
          <div className="ds-wf-row"><span className="ds-wf-dot" style={{ background: acc }} />• Point 2</div>
        </div>
      );
    case 'SkillButton':
      return (
        <div className="ds-wf ds-wf--toolbar">
          <span className="ds-wf-btn ds-wf-btn--primary" style={{ background: acc, borderColor: acc }}>Analyser</span>
          <span style={{ fontSize: 10, color: muted }}>pipeline 3 tiers · 6 skills</span>
        </div>
      );
    case 'RecorderBar':
      return (
        <div className="ds-wf ds-wf--toolbar">
          <span className="ds-wf-dot" style={{ background: 'var(--error)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>00:12:34</span>
          <span className="ds-wf-btn" style={{ borderColor: line, marginLeft: 'auto' }}>Stop</span>
        </div>
      );
    default:
      // Generic wireframe based on kind
      if (kind === 'modal') {
        return (
          <div className="ds-wf ds-wf--modal">
            <div className="ds-wf-bar" style={{ background: bg, borderColor: border }}>{name} <span style={{ marginLeft: 'auto' }}>×</span></div>
            <div className="ds-wf-field" style={{ borderColor: line }}>Contenu</div>
          </div>
        );
      }
      return (
        <div className="ds-wf ds-wf--widget">
          <div className="ds-wf-card" style={{ borderColor: border, background: bg, color: muted }}>{name}</div>
        </div>
      );
  }
}

const KIND_META: Record<LocalKind, { label: string; icon: ReactNode }> = {
  modal: {
    label: 'Modale',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <line x1="3" y1="9" x2="21" y2="9" />
      </svg>
    ),
  },
  form: {
    label: 'Formulaire',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="4" rx="1" />
        <rect x="4" y="12" width="16" height="4" rx="1" />
        <line x1="4" y1="20" x2="12" y2="20" />
      </svg>
    ),
  },
  panel: {
    label: 'Panneau',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </svg>
    ),
  },
  widget: {
    label: 'Widget',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" />
      </svg>
    ),
  },
  board: {
    label: 'Plateau',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
        <line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    ),
  },
  list: {
    label: 'Liste',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    ),
  },
  toolbar: {
    label: 'Barre d\'outils',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="8" width="18" height="8" rx="1" />
        <line x1="8" y1="12" x2="8.01" y2="12" />
        <line x1="13" y1="12" x2="17" y2="12" />
      </svg>
    ),
  },
  marker: {
    label: 'Marqueur',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 22h20L12 2z" />
      </svg>
    ),
  },
};
import auditData from '../../../../../design-system.data.json';
import './App.css';

// ── Auto-generated audit data ───────────────────────────────────────────────
// Shape is defined + maintained by `scripts/audit-components.ts`.
interface AuditData {
  generatedAt: string;
  scope: Array<{ id: string; label: string; color: string }>;
  shared: {
    exported: string[];
    used: Array<{
      name: string;
      modules: string[];
      usagesByModule: Record<string, number>;
      total: number;
    }>;
    unused: string[];
  };
  localByModule: Record<string, Array<{ name: string; file: string; usages: number; possibleDuplicateOf: string | null }>>;
  duplicates: Array<{ pattern: string; implementations: Array<{ module: string; name: string; file: string }> }>;
  stats: Array<{ moduleId: string; fileCount: number; sharedImportsCount: number; localComponentsCount: number }>;
}
const AUDIT = auditData as AuditData;

// ── Token data (hand-maintained — these are DS primitives, not audited) ─────
const COLORS: Array<{ label: string; sub?: ReactNode; tokens: Array<{ name: string; desc: string }> }> = [
  { label: 'Fonds',
    sub: 'Niveaux de fond appliqués à toutes les surfaces (page, cartes, inputs, hover).',
    tokens: [
      { name: '--bg-primary', desc: 'Fond principal' },
      { name: '--bg-secondary', desc: 'Fond secondaire' },
      { name: '--bg-tertiary', desc: 'Fond tertiaire' },
      { name: '--bg-card', desc: 'Fond carte' },
      { name: '--bg-input', desc: 'Fond input' },
      { name: '--bg-hover', desc: 'Fond hover' },
    ],
  },
  { label: 'Texte',
    sub: 'Hiérarchie typographique (titre → corps → discret → léger → inverse sur fond accent).',
    tokens: [
      { name: '--text-primary', desc: 'Texte principal' },
      { name: '--text-secondary', desc: 'Texte secondaire' },
      { name: '--text-muted', desc: 'Texte discret' },
      { name: '--text-light', desc: 'Texte léger' },
      { name: '--text-inverse', desc: 'Texte inverse' },
    ],
  },
  { label: 'Accent',
    sub: "Couleur principale de l'app (cyan). Les modules peuvent surcharger --accent-primary localement.",
    tokens: [
      { name: '--accent-primary', desc: 'Accent principal' },
      { name: '--accent-primary-hover', desc: 'Accent hover' },
      { name: '--accent-secondary', desc: 'Accent secondaire' },
      { name: '--accent-light', desc: 'Accent fond' },
    ],
  },
  { label: 'Bordures',
    sub: 'Séparateurs standards.',
    tokens: [
      { name: '--border-color', desc: 'Bordure standard' },
      { name: '--border-light', desc: 'Bordure légère' },
    ],
  },
  { label: 'Feedback (génériques)',
    sub: (
      <>
        Tokens sémantiques globaux — utilisés par <code>Toast</code>, <code>Badge</code>,
        validations <code>FormField</code>, bordures d'erreur. À ne pas confondre avec
        <code> StatusTag</code> ci-dessous (couleurs métier SuiviTess).
      </>
    ),
    tokens: [
      { name: '--success', desc: 'Succès' },
      { name: '--warning', desc: 'Warning' },
      { name: '--error', desc: 'Erreur' },
      { name: '--info', desc: 'Info' },
    ],
  },
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

// ── Inline demos for shared components ──────────────────────────────────────
//
// Each entry is rendered ONLY if the component is listed in `AUDIT.shared.used`
// OR in `AUDIT.shared.unused` (so we can also surface demos for archivable
// exports with a warning). The rendering is wrapped by `SharedComponentCard`.
//
// Keys match the component name exported from `@boilerplate/shared/components`.
type DemoViewMode = 'month' | 'quarter' | 'year';

type DemoContext = {
  addToast: (t: Omit<ToastData, 'id'>) => void;
  openModal: () => void;
  openConfirm: () => void;
  openSharing: () => void;
  visibility: Visibility;
  setVisibility: (v: Visibility) => void;
  tabValue: string;
  setTabValue: (v: string) => void;
  formName: string;
  setFormName: (v: string) => void;
  formError: string;
  setFormError: (v: string) => void;
  viewMode: DemoViewMode;
  setViewMode: (v: DemoViewMode) => void;
  viewYear: number;
  setViewYear: (n: number) => void;
};

function buildInlineDemos(ctx: DemoContext): Record<string, ReactNode> {
  return {
    Button: (
      <div className="ds-comp-row">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" disabled>Disabled</Button>
      </div>
    ),

    Badge: (
      <div className="ds-comp-row">
        <Badge type="success">Success</Badge>
        <Badge type="warning">Warning</Badge>
        <Badge type="error">Error</Badge>
        <Badge type="info">Info</Badge>
        <Badge type="accent">Accent</Badge>
      </div>
    ),

    Card: (
      <div className="ds-comp-row">
        <Card><h4 style={{ margin: 0 }}>Carte par défaut</h4><p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>Contenu standard</p></Card>
        <Card variant="compact"><h4 style={{ margin: 0 }}>Variante compacte</h4></Card>
        <Card onClick={() => ctx.addToast({ type: 'info', message: 'Card cliquée' })} variant="interactive">
          <h4 style={{ margin: 0 }}>Interactive</h4>
          <p style={{ margin: '6px 0 0', color: 'var(--text-muted)' }}>Clique-moi</p>
        </Card>
        <Card selected><h4 style={{ margin: 0, color: 'var(--accent-primary)' }}>Sélectionnée</h4></Card>
      </div>
    ),

    FormField: (
      <div className="ds-form-demo">
        <div className="ds-color-group">
          <h3 className="ds-group-label">États par défaut</h3>
          <FormField label="Nom" required>
            <input
              type="text"
              value={ctx.formName}
              onChange={e => {
                ctx.setFormName(e.target.value);
                ctx.setFormError(e.target.value.length < 3 && e.target.value.length > 0 ? '3 caractères minimum' : '');
              }}
              placeholder="Entrer un nom…"
            />
          </FormField>
          <FormField label="Email">
            <input type="email" placeholder="email@exemple.com" />
          </FormField>
          {ctx.formError && (
            <FormField label="Validation dynamique" error={ctx.formError}>
              <input type="text" value={ctx.formName} readOnly />
            </FormField>
          )}
        </div>
        <div className="ds-color-group">
          <h3 className="ds-group-label">Messages d'erreur — catalogue</h3>
          <FormField label="Champ requis" required error="Ce champ est obligatoire">
            <input type="text" placeholder="Saisir une valeur…" />
          </FormField>
          <FormField label="Email" error="Format d'email invalide">
            <input type="email" defaultValue="pas-un-email" />
          </FormField>
          <FormField label="Mot de passe" error="Le mot de passe doit contenir au moins 8 caractères">
            <input type="password" defaultValue="abc" />
          </FormField>
          <FormField label="Longueur minimale" error="3 caractères minimum (actuellement 2)">
            <input type="text" defaultValue="ab" />
          </FormField>
          <FormField label="Longueur maximale" error="50 caractères maximum (actuellement 62)">
            <textarea defaultValue="Un texte beaucoup trop long pour passer la validation." rows={2} />
          </FormField>
          <FormField label="Date" error="La date doit être postérieure à aujourd'hui">
            <input type="date" defaultValue="2020-01-01" />
          </FormField>
          <FormField label="Unicité" error="Ce nom est déjà utilisé">
            <input type="text" defaultValue="admin" />
          </FormField>
        </div>
      </div>
    ),

    LoadingSpinner: (
      <div className="ds-comp-row">
        <LoadingSpinner size="sm" />
        <LoadingSpinner />
        <LoadingSpinner size="lg" />
      </div>
    ),

    Modal: (
      <div className="ds-comp-row">
        <Button variant="secondary" onClick={ctx.openModal}>Ouvrir Modal</Button>
        <Button variant="secondary" onClick={ctx.openConfirm}>Ouvrir ConfirmModal</Button>
      </div>
    ),

    ConfirmModal: (
      <div className="ds-comp-row">
        <Button variant="secondary" onClick={ctx.openConfirm}>Ouvrir ConfirmModal</Button>
      </div>
    ),

    Tabs: (
      <div>
        <Tabs
          tabs={[
            { value: 'tab1', label: 'Onglet 1' },
            { value: 'tab2', label: 'Onglet 2' },
            { value: 'tab3', label: 'Onglet 3' },
          ]}
          value={ctx.tabValue}
          onChange={ctx.setTabValue}
        />
        <p style={{ padding: 'var(--spacing-sm) 0', color: 'var(--text-muted)' }}>
          Contenu de <code>{ctx.tabValue}</code>
        </p>
      </div>
    ),

    ExpandableSection: (
      <ExpandableSection title="Cliquez pour déployer" defaultExpanded badge={3}>
        <p style={{ margin: 0, color: 'var(--text-muted)' }}>
          Contenu déployable — utile pour sections longues repliables.
        </p>
      </ExpandableSection>
    ),

    ModuleHeader: (
      <div className="ds-comp-constrained ds-module-header-demo" style={{ border: '1px solid var(--border-color)' }}>
        <ModuleHeader
          title="Titre du module"
          subtitle="Sous-titre"
          onBack={() => ctx.addToast({ type: 'info', message: 'Retour cliqué' })}
        >
          <Button variant="secondary">Action 1</Button>
          <Button variant="primary">Action 2</Button>
        </ModuleHeader>
      </div>
    ),

    VisibilityPicker: (
      <div className="ds-comp-constrained">
        <VisibilityPicker value={ctx.visibility} onChange={ctx.setVisibility} />
        <p style={{ marginTop: 'var(--spacing-sm)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
          Valeur actuelle : <code>{ctx.visibility}</code>
        </p>
      </div>
    ),

    SharingModal: (
      <div className="ds-comp-row">
        <Button variant="primary" onClick={ctx.openSharing}>Ouvrir SharingModal</Button>
      </div>
    ),

    ToastContainer: (
      <div className="ds-comp-row">
        <Button variant="secondary" onClick={() => ctx.addToast({ type: 'success', message: 'Action réussie !' })}>Success</Button>
        <Button variant="secondary" onClick={() => ctx.addToast({ type: 'error', message: 'Une erreur est survenue' })}>Error</Button>
        <Button variant="secondary" onClick={() => ctx.addToast({ type: 'info', message: 'Information utile' })}>Info</Button>
        <Button variant="secondary" onClick={() => ctx.addToast({ type: 'warning', message: 'Attention requise' })}>Warning</Button>
      </div>
    ),

    ViewSelector: (
      <div className="ds-comp-constrained" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <div>
          <h3 className="ds-group-label">Mode seul</h3>
          <ViewSelector<DemoViewMode>
            viewMode={ctx.viewMode}
            onViewModeChange={ctx.setViewMode}
            modes={[
              { value: 'month', label: 'Mois' },
              { value: 'quarter', label: 'Trimestre' },
              { value: 'year', label: 'Année' },
            ] as ReadonlyArray<ViewModeOption<DemoViewMode>>}
          />
        </div>
        <div>
          <h3 className="ds-group-label">Mode + navigation année</h3>
          <ViewSelector<DemoViewMode>
            viewMode={ctx.viewMode}
            onViewModeChange={ctx.setViewMode}
            modes={[
              { value: 'month', label: 'Mois' },
              { value: 'quarter', label: 'Trimestre' },
              { value: 'year', label: 'Année' },
            ] as ReadonlyArray<ViewModeOption<DemoViewMode>>}
            year={ctx.viewYear}
            onYearChange={(dir) => ctx.setViewYear(ctx.viewYear + dir)}
            onToday={() => ctx.setViewYear(new Date().getFullYear())}
          />
        </div>
      </div>
    ),

    Legend: (
      <div className="ds-comp-constrained" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <div>
          <h3 className="ds-group-label">Direction column (défaut)</h3>
          <Legend
            ariaLabel="Légende motifs de congé"
            items={[
              { id: 'cp', color: '#10b981', label: 'Congé payé' },
              { id: 'rtt', color: '#3b82f6', label: 'RTT' },
              { id: 'maladie', color: '#ef4444', label: 'Maladie' },
              { id: 'sans_solde', color: '#a855f7', label: 'Sans solde' },
            ]}
          />
        </div>
        <div>
          <h3 className="ds-group-label">Direction row</h3>
          <Legend
            direction="row"
            items={[
              { id: 'todo', color: '#ef4444', label: 'À faire' },
              { id: 'doing', color: '#f59e0b', label: 'En cours' },
              { id: 'done', color: '#10b981', label: 'Terminé' },
            ]}
          />
        </div>
      </div>
    ),

    EmptyState: (
      <div className="ds-comp-constrained" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          <EmptyState
            title="Aucun élément"
            hint="Créer votre premier élément pour commencer."
          />
        </div>
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)' }}>
          <EmptyState
            icon={
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            }
            title="Aucune roadmap"
            hint="Créer votre première roadmap pour commencer"
            action={<Button variant="primary" onClick={() => ctx.addToast({ type: 'info', message: 'Action EmptyState' })}>+ Nouvelle roadmap</Button>}
          />
        </div>
      </div>
    ),

    StatusTag: (
      <div className="ds-comp-constrained" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
        <div>
          <h3 className="ds-group-label">Variante dot (défaut, canonique SuiviTess)</h3>
          <div className="ds-comp-row">
            {STATUS_OPTIONS.map(opt => (
              <StatusTag key={opt.value} label={opt.label} color={opt.color} />
            ))}
          </div>
        </div>
        <div>
          <h3 className="ds-group-label">Variante tint</h3>
          <div className="ds-comp-row">
            {STATUS_OPTIONS.slice(0, 4).map(opt => (
              <StatusTag key={opt.value} label={opt.label} color={opt.color} variant="tint" />
            ))}
          </div>
        </div>
        <div>
          <h3 className="ds-group-label">Variante outline</h3>
          <div className="ds-comp-row">
            {STATUS_OPTIONS.slice(0, 4).map(opt => (
              <StatusTag key={opt.value} label={opt.label} color={opt.color} variant="outline" />
            ))}
          </div>
        </div>
        <div>
          <h3 className="ds-group-label">Variante solid</h3>
          <div className="ds-comp-row">
            {STATUS_OPTIONS.slice(0, 4).map(opt => (
              <StatusTag key={opt.value} label={opt.label} color={opt.color} variant="solid" />
            ))}
          </div>
        </div>
      </div>
    ),

    ModalBody: (
      <div className="ds-comp-constrained" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        Primitive <code>&lt;ModalBody&gt;</code> — wrapper vertical standard pour le contenu d'une modale (padding + gap uniformes). S'utilise à l'intérieur d'un <code>&lt;Modal&gt;</code>. Cf. démo <strong>Modal</strong> ci-dessus pour un exemple complet.
      </div>
    ),

    ModalActions: (
      <div className="ds-comp-constrained" style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
        Primitive <code>&lt;ModalActions&gt;</code> — footer de modale aligné à droite avec margin-top standard. S'utilise après un <code>&lt;ModalBody&gt;</code>. Cf. démo <strong>Modal</strong> ci-dessus pour un exemple complet.
      </div>
    ),
  };
}

// French display labels for shared components (fallback to the import name).
const FRENCH_LABELS: Record<string, string> = {
  Button: 'Bouton',
  Card: 'Carte',
  Badge: 'Badge',
  FormField: 'Champ de formulaire',
  LoadingSpinner: 'Indicateur de chargement',
  Modal: 'Modale',
  ModalBody: 'Modale — corps',
  ModalActions: 'Modale — actions',
  ConfirmModal: 'Modale de confirmation',
  Tabs: 'Onglets',
  ExpandableSection: 'Section pliable',
  ModuleHeader: 'En-tête de module',
  VisibilityPicker: 'Sélecteur de visibilité',
  SharingModal: 'Modale de partage',
  Toast: 'Toast',
  ToastContainer: 'Toast (conteneur)',
  Layout: 'Layout',
  SectionTitle: 'Titre de section',
  SharedNav: 'Navigation partagée',
  ListEditor: 'Éditeur de liste',
  TagEditor: 'Éditeur de tags',
  ImageUploader: "Uploader d'image",
  ProjectEditor: 'Éditeur de projets',
  Hero: "Bandeau d'en-tête",
  StatCounter: 'Compteur de statistiques',
  Footer: 'Pied de page',
  ViewSelector: 'Sélecteur de vue',
  Legend: 'Légende',
  EmptyState: 'État vide',
  StatusTag: 'Tag de statut',
};

// ── Mock data for module-level demos (GanttBoard + BoardDelivery) ───────────
const now = new Date().toISOString();

const mockPlanning: Planning = {
  id: 'demo-1', name: 'Q2 Roadmap', description: 'Planning demo',
  startDate: '2026-04-22', endDate: '2026-07-31',
  createdAt: now, updatedAt: now,
};

const mockRoadmapTasks: RoadmapTask[] = [
  { id: '__virtual_delivery__', planningId: 'demo-1', parentId: null, name: 'Delivery',
    description: null, startDate: '2026-04-22', endDate: '2026-07-15', color: '#7280a0', progress: 0, sortOrder: -1,
    createdAt: now, updatedAt: now,
    isVirtual: true, readOnly: true, virtualSource: 'delivery',
  },
  { id: '__virtual_auth_42', planningId: 'demo-1', parentId: '__virtual_delivery__', name: 'Auth refactor',
    description: null, startDate: '2026-04-22', endDate: '2026-05-09', color: 'var(--info)', progress: 0, sortOrder: 0,
    createdAt: now, updatedAt: now,
    isVirtual: true, readOnly: true, compact: true, status: 'in_progress',
    jiraKey: 'AUTH-42', boardName: 'Sprint Board Demo', source: 'jira', assignee: 'Max',
  },
  { id: '__virtual_devops_12', planningId: 'demo-1', parentId: '__virtual_delivery__', name: 'CI/CD pipeline',
    description: null, startDate: '2026-05-15', endDate: '2026-06-08', color: 'var(--gray-500, var(--text-muted))', progress: 0, sortOrder: 1,
    createdAt: now, updatedAt: now,
    isVirtual: true, readOnly: true, compact: true, status: 'todo',
    jiraKey: 'DEVOPS-12', boardName: 'Sprint Board Demo', source: 'jira', assignee: 'Tom',
  },
  { id: '__virtual_auth_51', planningId: 'demo-1', parentId: '__virtual_delivery__', name: 'Fix login bug',
    description: null, startDate: '2026-06-15', endDate: '2026-07-02', color: 'var(--success)', progress: 0, sortOrder: 2,
    createdAt: now, updatedAt: now,
    isVirtual: true, readOnly: true, compact: true, status: 'done',
    jiraKey: 'AUTH-51', boardName: 'Sprint Board Demo', source: 'jira', assignee: 'Lea',
  },
  { id: 'rt1',  planningId: 'demo-1', parentId: null,  name: 'Design System',           description: 'Tokens + composants partagés', startDate: '2026-04-22', endDate: '2026-05-31', color: '#00bcd4', progress: 60, sortOrder: 0, createdAt: now, updatedAt: now },
  { id: 'rt1a', planningId: 'demo-1', parentId: 'rt1', name: 'Tokens (couleurs, typo)', description: null,                           startDate: '2026-04-22', endDate: '2026-05-06', color: '#00bcd4', progress: 80,  sortOrder: 0, createdAt: now, updatedAt: now },
  { id: 'rt1b', planningId: 'demo-1', parentId: 'rt1', name: 'Composants forms',        description: null,                           startDate: '2026-05-09', endDate: '2026-05-22', color: '#00bcd4', progress: 30, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: 'rt1c', planningId: 'demo-1', parentId: 'rt1', name: 'Showcase page',           description: null,                           startDate: '2026-05-25', endDate: '2026-05-31', color: '#00bcd4', progress: 0,  sortOrder: 2, createdAt: now, updatedAt: now },
  { id: 'rt2',  planningId: 'demo-1', parentId: null,  name: 'API v2',          description: "Refonte de l'API publique", startDate: '2026-06-03', endDate: '2026-07-05', color: '#8b5cf6', progress: 0, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: 'rt2a', planningId: 'demo-1', parentId: 'rt2', name: 'Auth refactor',   description: null,                        startDate: '2026-06-03', endDate: '2026-06-17', color: '#8b5cf6', progress: 0, sortOrder: 0, createdAt: now, updatedAt: now },
  { id: 'rt2b', planningId: 'demo-1', parentId: 'rt2', name: 'Rate limiting',   description: null,                        startDate: '2026-06-22', endDate: '2026-07-05', color: '#8b5cf6', progress: 0, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: 'rt3',  planningId: 'demo-1', parentId: null,  name: 'Tests E2E Playwright', description: null, startDate: '2026-07-08', endDate: '2026-07-25', color: '#4caf50', progress: 0, sortOrder: 2, createdAt: now, updatedAt: now },
];

const mockDependencies: Dependency[] = [
  { id: 'd1', fromTaskId: 'rt1a', toTaskId: 'rt1b', type: 'finish-to-start', createdAt: now },
  { id: 'd2', fromTaskId: 'rt1b', toTaskId: 'rt1c', type: 'finish-to-start', createdAt: now },
  { id: 'd3', fromTaskId: 'rt2a', toTaskId: 'rt2b', type: 'finish-to-start', createdAt: now },
  { id: 'd4', fromTaskId: 'rt2',  toTaskId: 'rt3',  type: 'finish-to-start', createdAt: now },
];

const mockMarkers: Marker[] = [
  { id: 'm1', planningId: 'demo-1', name: 'MEP v1.5',        markerDate: '2026-05-20', color: '#3b82f6', type: 'milestone', taskId: null, createdAt: now, updatedAt: now },
  { id: 'm2', planningId: 'demo-1', name: 'Release v2',      markerDate: '2026-06-30', color: '#f44336', type: 'milestone', taskId: null, createdAt: now, updatedAt: now },
  { id: 'm3', planningId: 'demo-1', name: 'Revue trimestre', markerDate: '2026-07-20', color: '#10b981', type: 'milestone', taskId: null, createdAt: now, updatedAt: now },
];

const mockSprints: Sprint[] = [
  { id: 's1', name: 'Sprint 14', startDate: '2026-04-13', endDate: '2026-04-26' },
  { id: 's2', name: 'Sprint 15', startDate: '2026-04-27', endDate: '2026-05-10' },
  { id: 's3', name: 'Sprint 16', startDate: '2026-05-11', endDate: '2026-05-24' },
];

const mockDeliveryTasks: DeliveryTask[] = [
  { id: 'dt1', title: '[AUTH-42] Auth refactor',             type: 'feature',   status: 'in_progress', startCol: 0, endCol: 2, row: 0, storyPoints: 8, estimatedDays: 5, assignee: 'Max', priority: 'high',     source: 'jira' },
  { id: 'dt2', title: '[AUTH-51] Fix login bug',             type: 'bug',       status: 'done',        startCol: 1, endCol: 2, row: 1, storyPoints: 3, estimatedDays: 2, assignee: 'Lea', priority: 'critical', source: 'jira' },
  { id: 'dt3', title: '[DEVOPS-12] CI/CD pipeline',          type: 'tech',      status: 'todo',        startCol: 3, endCol: 5, row: 0, storyPoints: 5, estimatedDays: 3, assignee: 'Tom', priority: 'medium',   source: 'jira' },
  { id: 'dt4', title: '[AUTH-44] SSO Microsoft',             type: 'feature',   status: 'todo',        startCol: 2, endCol: 4, row: 2, storyPoints: 5, estimatedDays: 4, assignee: 'Max', priority: 'medium',   source: 'jira' },
  { id: 'dt5', title: '[DEVOPS-18] Migration Docker 24',     type: 'tech',      status: 'in_progress', startCol: 4, endCol: 6, row: 1, storyPoints: 3, estimatedDays: 2, assignee: 'Tom', priority: 'low',      source: 'jira' },
  { id: 'dt6', title: 'Audit sécurité trimestriel',          type: 'milestone', status: 'todo',        startCol: 5, endCol: 6, row: 3, source: 'manual' },
];

const mockReleases: Release[] = [
  { id: 'r1', date: '2026-04-26', version: 'v1.5',  projectKey: 'AUTH',   color: '#3b82f6' },
  { id: 'r2', date: '2026-05-10', version: 'v2.0',  projectKey: 'AUTH',   color: '#3b82f6' },
  { id: 'r3', date: '2026-05-20', version: '24.04', projectKey: 'DEVOPS', color: '#f59e0b' },
];

// ── Swatches ────────────────────────────────────────────────────────────────
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

function RawColorSwatch({ value, label, gradientEnd }: { value: string; label: string; gradientEnd?: string }) {
  const bg = gradientEnd ? `linear-gradient(135deg, ${value}, ${gradientEnd})` : value;
  return (
    <div className="ds-swatch">
      <div className="ds-swatch-color" style={{ background: bg }} />
      <div className="ds-swatch-info">
        <span className="ds-swatch-name">{label}</span>
        <span className="ds-swatch-desc">{value}{gradientEnd ? ` → ${gradientEnd}` : ''}</span>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

// ── Main ────────────────────────────────────────────────────────────────────
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

  const [tabValue, setTabValue] = useState('tab1');
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState('');
  const [viewMode, setViewMode] = useState<DemoViewMode>('month');
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  // Kept for future CV editors section — unused today.
  const [, setProjects] = useState<ProjectItem[]>([
    { title: 'Projet Alpha', description: 'Refonte du design system' },
    { title: 'Projet Beta', description: 'Migration API v2' },
  ]);
  void setProjects;
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [showSharing, setShowSharing] = useState(false);
  const [themeAppId, setThemeAppId] = useState<string>(APPS[0]?.id ?? '');
  const themeApp = APPS.find(a => a.id === themeAppId) ?? APPS[0];

  const demos = buildInlineDemos({
    addToast,
    openModal: () => setShowModal(true),
    openConfirm: () => setShowConfirm(true),
    openSharing: () => setShowSharing(true),
    visibility, setVisibility,
    tabValue, setTabValue,
    formName, setFormName,
    formError, setFormError,
    viewMode, setViewMode,
    viewYear, setViewYear,
  });

  // Only surface shared components that are actually used in the 5
  // scoped modules. Unused exports (listed in AUDIT.shared.unused) are
  // hidden — they clutter the DS page without providing usage signal.
  const sharedEntries = AUDIT.shared.used.map(u => ({
    name: u.name,
    total: u.total,
    modules: u.modules,
    usagesByModule: u.usagesByModule,
    unused: false,
  }));

  return (
    <Layout appId="design-system" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader title="Design System" onBack={() => onNavigate?.('/')} />
      <div className="ds-page">

        {/* ── Intro / méta ── */}
        <section className="ds-section">
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--spacing-sm)' }}>
            Référence visuelle des composants partagés et locaux <strong>réellement utilisés</strong>{' '}
            dans les modules en production : <strong>{AUDIT.scope.map(s => s.label).join(', ')}</strong>.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', marginBottom: 'var(--spacing-xs)' }}>
            Données générées automatiquement par <code>npm run audit:components</code> — dernier
            audit : <strong>{formatDate(AUDIT.generatedAt)}</strong>.
          </p>
          <div className="ds-audit-stats">
            {AUDIT.stats.map(s => {
              const scope = AUDIT.scope.find(sc => sc.id === s.moduleId);
              return (
                <div key={s.moduleId} className="ds-audit-stat">
                  <span className="ds-audit-stat-dot" style={{ background: scope?.color }} />
                  <div>
                    <div className="ds-audit-stat-label">{scope?.label ?? s.moduleId}</div>
                    <div className="ds-audit-stat-value">
                      {s.fileCount} fichiers · {s.sharedImportsCount} shared · {s.localComponentsCount} locaux
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Sommaire sticky ── */}
        <nav className="ds-toc" aria-label="Sommaire du design system">
          <span className="ds-toc-label">Sommaire</span>
          <div className="ds-toc-group">
            <span className="ds-toc-group-title">1. Design System</span>
            <ul>
              <li><a href="#ds-tokens">Vue d'ensemble</a></li>
              <li><a href="#ds-colors">Couleurs</a></li>
              <li><a href="#ds-typo">Typographie</a></li>
              <li><a href="#ds-spacing">Espacements</a></li>
              <li><a href="#ds-radius">Rayons</a></li>
              <li><a href="#ds-shadow">Ombres</a></li>
              <li><a href="#ds-components">Composants partagés</a></li>
            </ul>
          </div>
          <div className="ds-toc-group">
            <span className="ds-toc-group-title">2. Composants locaux</span>
            <ul>
              <li><a href="#ds-locals">Par module</a></li>
            </ul>
          </div>
          <div className="ds-toc-group">
            <span className="ds-toc-group-title">3. Vues métier</span>
            <ul>
              <li><a href="#ds-gantt">Démos complexes</a></li>
            </ul>
          </div>
        </nav>

        {/* ══════════════════════════════════════════════════════════════════
            PARTIE 1 — DESIGN SYSTEM
            ══════════════════════════════════════════════════════════════════ */}
        <div className="ds-part-header" id="ds-tokens">
          <h2 className="ds-part-title">1. Design System</h2>
          <p className="ds-part-sub">
            Tokens globaux et composants partagés exposés par{' '}
            <code>@boilerplate/shared/components</code>.
          </p>
        </div>

        {/* ── Colors ── */}
        <section className="ds-section" id="ds-colors">
          <h3 className="ds-section-title">Couleurs</h3>
          {COLORS.map(group => (
            <div key={group.label} className="ds-color-group">
              <h3 className="ds-group-label">{group.label}</h3>
              {group.sub && <p className="ds-group-sub">{group.sub}</p>}
              <div className="ds-swatches">
                {group.tokens.map(t => <ColorSwatch key={t.name} name={t.name} desc={t.desc} />)}
              </div>
            </div>
          ))}
          <div className="ds-color-group">
            <h3 className="ds-group-label">Modules</h3>
            <p className="ds-group-sub">
              Couleurs de marque des applications — source : <code>APPS</code> dans
              <code> @boilerplate/shared</code>. Utilisées pour les pastilles <code>SharedNav</code>,
              les icônes du dashboard et les gradients de landing.
            </p>
            <div className="ds-swatches">
              {APPS.map(app => (
                <RawColorSwatch key={app.id} value={app.color} gradientEnd={app.gradientEnd} label={app.name} />
              ))}
            </div>
          </div>
          <div className="ds-color-group">
            <h3 className="ds-group-label">ModeTag</h3>
            <p className="ds-group-sub">
              Spécifique à <code>SuiviTess</code> — distingue les sujets « créés » (jaune) des
              « mises à jour » (bleu) dans la modale d'import routing.
            </p>
            <div className="ds-swatches">
              <RawColorSwatch value="#eab308" label="+ Nouveau" />
              <RawColorSwatch value="#3b82f6" label="Mise à jour" />
            </div>
          </div>
          <div className="ds-color-group">
            <h3 className="ds-group-label">StatusTag</h3>
            <p className="ds-group-sub">
              Spécifique à <code>SuiviTess</code> — états métier des sujets. Source :{' '}
              <code>STATUS_OPTIONS</code> dans <code>modules/suivitess/types</code>.
            </p>
            <div className="ds-swatches">
              {STATUS_OPTIONS.map(opt => (
                <RawColorSwatch key={opt.value} value={opt.color} label={opt.label} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Couleur principale du module (interactive preview) ── */}
        <section className="ds-section">
          <h3 className="ds-section-title">Couleur principale du module</h3>
          <p className="ds-section-sub">
            Chaque module possède une <strong>couleur de marque</strong> qui surcharge
            <code> --accent-primary</code> pour tous ses composants. Le composant
            <code> Layout</code> injecte la couleur en inline-style, ce qui fait
            cascader la valeur vers tous les enfants utilisant <code>var(--accent-primary)</code>.
          </p>
          <div className="ds-module-switcher">
            {APPS.map(app => {
              const active = app.id === themeAppId;
              return (
                <button
                  key={app.id}
                  type="button"
                  className={`ds-module-switcher-btn ${active ? 'is-active' : ''}`}
                  onClick={() => setThemeAppId(app.id)}
                  style={{ ['--module-color' as string]: app.color, ['--module-gradient-end' as string]: app.gradientEnd } as CSSProperties}
                >
                  <span className="ds-module-switcher-dot" />
                  {app.name}
                </button>
              );
            })}
          </div>
          <div
            className="ds-theme-preview"
            style={{
              ['--accent-primary' as string]: themeApp.color,
              ['--accent-primary-hover' as string]: themeApp.gradientEnd,
            } as CSSProperties}
          >
            <div className="ds-theme-preview-header">
              <strong style={{ color: 'var(--accent-primary)' }}>{themeApp.name}</strong>
              <code className="ds-theme-preview-hex">
                --accent-primary: {themeApp.color} · --accent-primary-hover: {themeApp.gradientEnd}
              </code>
            </div>
            <div className="ds-theme-preview-grid">
              <div className="ds-theme-preview-block">
                <span className="ds-theme-preview-label">Boutons</span>
                <div className="ds-comp-row">
                  <Button variant="primary">Action principale</Button>
                  <Button variant="secondary">Secondaire</Button>
                </div>
              </div>
              <div className="ds-theme-preview-block">
                <span className="ds-theme-preview-label">Loader</span>
                <div className="ds-comp-row">
                  <LoadingSpinner size="sm" />
                  <LoadingSpinner />
                </div>
              </div>
              <div className="ds-theme-preview-block">
                <span className="ds-theme-preview-label">Focus</span>
                <input
                  type="text"
                  placeholder="Clique pour voir le focus ring"
                  className="ds-theme-preview-input"
                />
              </div>
              <div className="ds-theme-preview-block">
                <span className="ds-theme-preview-label">Lien</span>
                <a
                  href="#"
                  onClick={e => e.preventDefault()}
                  style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
                >
                  Consulter la documentation →
                </a>
              </div>
              <div className="ds-theme-preview-block">
                <span className="ds-theme-preview-label">Bordure active</span>
                <div
                  style={{
                    padding: 'var(--spacing-sm)',
                    border: '2px solid var(--accent-primary)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  Élément sélectionné
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Règles UX du DS ── */}
        <section className="ds-section">
          <h3 className="ds-section-title">Règles UX du design system</h3>
          <p className="ds-section-sub">
            Conventions systémiques qui s'appliquent à <strong>tous les modules</strong>.
            Ces règles sont enforcées par le composant <code>Layout</code> + les CSS
            partagés, il n'y a rien à faire au niveau du module pour en bénéficier.
          </p>
          <ul className="ds-rules-list">
            <li>
              <strong>Couleur dominante par module.</strong> Chaque module possède une
              couleur de marque définie dans <code>APPS</code>. Le composant
              <code> Layout</code> injecte <code>--accent-primary</code> en inline-style
              → tous les composants partagés à l'intérieur héritent.
            </li>
            <li>
              <strong>Hover du <code>Button</code> secondary.</strong> La bordure passe à{' '}
              <code>var(--accent-primary)</code> — donc au hover d'un CTA secondaire dans
              Congés : <span className="ds-rules-inline-chip" style={{ color: '#ec4899' }}>rose</span>,
              dans SuiviTess : <span className="ds-rules-inline-chip" style={{ color: '#10b981' }}>vert</span>,
              dans Roadmap : <span className="ds-rules-inline-chip" style={{ color: '#8b5cf6' }}>violet</span>,
              dans Delivery : <span className="ds-rules-inline-chip" style={{ color: '#ff9800' }}>orange</span>.
              <br />
              <em className="ds-rules-rationale">
                Règle définie dans <code>packages/shared/src/components/Button/Button.css</code>.
              </em>
            </li>
            <li>
              <strong>Focus ring.</strong> Tous les inputs focusables utilisent{' '}
              <code>var(--shadow-focus)</code> qui dérive aussi de l'accent du module —
              cohérence visuelle entre formulaires et boutons.
            </li>
            <li>
              <strong>Tokens avant hex.</strong> Aucun hex codé en dur dans le code applicatif.
              Les statuts SuiviTess passent par <code>STATUS_OPTIONS</code>, les couleurs
              de module par <code>APPS</code>, les ModeTag (new/update) par les
              variables inline de la modale de routing.
            </li>
            <li>
              <strong>Shared avant local.</strong> Un composant partagé (<code>Button</code>,{' '}
              <code>Modal</code>, <code>FormField</code>…) a toujours priorité sur une
              réimplémentation locale. Enforcé par le skill <code>ux-ui-guard</code> et
              le hook <code>.claude/hooks/ux-ui-enforcer.sh</code>.
            </li>
          </ul>
        </section>

        {/* ── Typography ── */}
        <section className="ds-section" id="ds-typo">
          <h3 className="ds-section-title">Typographie</h3>
          <div className="ds-color-group">
            <h3 className="ds-group-label">Titres H1 – H6</h3>
            <div className="ds-typo-samples">
              <div className="ds-typo-row"><span className="ds-typo-label">H1</span><h1 className="ds-typo-sample" style={{ margin: 0 }}>Titre principal — H1</h1></div>
              <div className="ds-typo-row"><span className="ds-typo-label">H2</span><h2 className="ds-typo-sample" style={{ margin: 0 }}>Titre de section — H2</h2></div>
              <div className="ds-typo-row"><span className="ds-typo-label">H3</span><h3 className="ds-typo-sample" style={{ margin: 0 }}>Sous-titre — H3</h3></div>
              <div className="ds-typo-row"><span className="ds-typo-label">H4</span><h4 className="ds-typo-sample" style={{ margin: 0 }}>Sous-section — H4</h4></div>
              <div className="ds-typo-row"><span className="ds-typo-label">H5</span><h5 className="ds-typo-sample" style={{ margin: 0 }}>Niveau 5 — H5</h5></div>
              <div className="ds-typo-row"><span className="ds-typo-label">H6</span><h6 className="ds-typo-sample" style={{ margin: 0 }}>Niveau 6 — H6</h6></div>
            </div>
          </div>
          <div className="ds-color-group">
            <h3 className="ds-group-label">Tailles de police (tokens)</h3>
            <div className="ds-typo-samples">
              {FONT_SIZES.map(fs => (
                <div key={fs.name} className="ds-typo-row" style={{ fontSize: `var(${fs.name})` }}>
                  <span className="ds-typo-label">{fs.label} ({fs.px})</span>
                  <span className="ds-typo-sample">Portez ce vieux whisky au juge blond qui fume.</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Spacing ── */}
        <section className="ds-section" id="ds-spacing">
          <h3 className="ds-section-title">Espacements</h3>
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

        {/* ── Border radius ── */}
        <section className="ds-section" id="ds-radius">
          <h3 className="ds-section-title">Rayons de bordure</h3>
          <div className="ds-radii">
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
        <section className="ds-section" id="ds-shadow">
          <h3 className="ds-section-title">Ombres</h3>
          <div className="ds-shadows">
            {SHADOWS.map(s => (
              <div key={s.name} className="ds-shadow-item">
                <div className="ds-shadow-box" style={{ boxShadow: `var(${s.name})` }} />
                <span className="ds-shadow-label">{s.label}</span>
                <span className="ds-shadow-token">{s.name}</span>
              </div>
            ))}
          </div>
        </section>

        {/* ── Shared components (auto-generated from audit) ── */}
        <div className="ds-part-header ds-part-header--sub" id="ds-components">
          <h3 className="ds-part-subtitle">Composants partagés</h3>
          <p className="ds-part-sub">
            {AUDIT.shared.used.length} composant{AUDIT.shared.used.length > 1 ? 's' : ''} partagé{AUDIT.shared.used.length > 1 ? 's' : ''} utilisé{AUDIT.shared.used.length > 1 ? 's' : ''} dans les modules.
          </p>
        </div>
        {sharedEntries.map(entry => {
          const demo = demos[entry.name];
          const frenchLabel = FRENCH_LABELS[entry.name] ?? entry.name;
          return (
            <section key={entry.name} className={`ds-section ${entry.unused ? 'ds-section--unused' : ''}`}>
              <div className="ds-component-header">
                <h3 className="ds-section-title">
                  {frenchLabel}
                  {entry.name !== frenchLabel && <span className="ds-component-name">{entry.name}</span>}
                </h3>
                {entry.unused ? (
                  <span className="ds-usage-badge ds-usage-badge--unused" title="Aucun import dans les 5 modules audités">
                    0 usage — candidat archivage
                  </span>
                ) : (
                  <span className="ds-usage-badge" title={`${entry.total} usages — ${entry.modules.join(', ')}`}>
                    {entry.total} usage{entry.total > 1 ? 's' : ''} ·{' '}
                    {entry.modules.map(m => {
                      const scope = AUDIT.scope.find(s => s.id === m);
                      return (
                        <span key={m} className="ds-usage-chip" style={{ borderColor: scope?.color, color: scope?.color }}>
                          {scope?.label ?? m} ({entry.usagesByModule[m] ?? 0})
                        </span>
                      );
                    })}
                  </span>
                )}
              </div>
              <p className="ds-component-path">@boilerplate/shared/components &rarr; {entry.name}</p>
              {demo ?? (
                <p className="ds-component-path" style={{ color: 'var(--text-muted)' }}>
                  (Pas de démo inline — consulte le code source ou <code>packages/shared/</code>.)
                </p>
              )}
            </section>
          );
        })}

        {/* ══════════════════════════════════════════════════════════════════
            PARTIE 2 — COMPOSANTS LOCAUX PAR MODULE
            ══════════════════════════════════════════════════════════════════ */}
        <div className="ds-part-header" id="ds-locals">
          <h2 className="ds-part-title">2. Composants locaux</h2>
          <p className="ds-part-sub">
            Composants spécifiques à un module — index auto-généré listant
            uniquement ceux effectivement utilisés (au moins 1 JSX usage).
          </p>
        </div>

        {AUDIT.duplicates.length > 0 && (
          <section className="ds-section ds-duplicates">
            <h3 className="ds-section-title">⚠️ Patterns dupliqués détectés</h3>
            <p className="ds-section-sub">
              Plusieurs modules implémentent des patterns similaires —
              candidats à promouvoir dans <code>packages/shared/</code>.
            </p>
            <ul className="ds-duplicates-list">
              {AUDIT.duplicates.map(d => (
                <li key={d.pattern}>
                  <strong>{d.pattern}</strong>
                  <ul>
                    {d.implementations.map(i => (
                      <li key={`${i.module}/${i.name}`}>
                        <code>{i.file}</code> ({i.module})
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}

        {AUDIT.scope.map(scope => {
          const locals = AUDIT.localByModule[scope.id] ?? [];
          if (locals.length === 0) {
            return (
              <section key={scope.id} className="ds-module-block">
                <h3 className="ds-module-title" style={{ borderLeftColor: scope.color }}>
                  <span className="ds-module-dot" style={{ background: scope.color }} />
                  {scope.label}
                  <span className="ds-module-count">(aucun composant local)</span>
                </h3>
              </section>
            );
          }
          return (
            <section key={scope.id} className="ds-module-block">
              <h3 className="ds-module-title" style={{ borderLeftColor: scope.color }}>
                <span className="ds-module-dot" style={{ background: scope.color }} />
                {scope.label}
                <span className="ds-module-count">({locals.length} composant{locals.length > 1 ? 's' : ''})</span>
              </h3>
              <div className="ds-module-grid">
                {locals.map(c => {
                  const kind: LocalKind = LOCAL_KIND[c.name] ?? 'widget';
                  const meta = KIND_META[kind];
                  return (
                    <div key={c.name} className={`ds-module-item ds-module-item--${kind}`}>
                      <div className="ds-module-item-preview" style={{ ['--local-accent' as string]: scope.color }}>
                        <LocalWireframe name={c.name} kind={kind} color={scope.color} />
                      </div>
                      <div className="ds-module-item-kind">{meta.label}</div>
                      <div className="ds-module-item-name">{c.name}</div>
                      {c.possibleDuplicateOf && (
                        <div style={{ fontSize: 10, color: 'var(--warning)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          ⚠ pattern {c.possibleDuplicateOf}
                        </div>
                      )}
                      <div className="ds-module-item-desc">
                        {c.usages} usage{c.usages > 1 ? 's' : ''} dans ce module.
                      </div>
                      <code className="ds-module-item-file">{c.file}</code>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {/* ── Module-level demos (complex components requiring mocks) ── */}
        <div className="ds-part-header ds-part-header--sub" id="ds-gantt">
          <h3 className="ds-part-subtitle">Démos de composants complexes</h3>
          <p className="ds-part-sub">
            Composants nécessitant des données structurées — montrés ici avec des
            mocks pour pouvoir inspecter l'UI sans dépendance backend.
          </p>
        </div>

        <section className="ds-section">
          <h3 className="ds-section-title">Diagramme de Gantt (Roadmap)</h3>
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
              onMarkerUpdate={() => {}}
              onMarkerDelete={() => {}}
              onAddMarker={() => {}}
              readOnly
              autoHeight
            />
          </div>
        </section>

        <section className="ds-section">
          <h3 className="ds-section-title">Plateau Delivery</h3>
          <p className="ds-component-path">modules/delivery/components/BoardDelivery</p>
          <div className="ds-delivery-demo">
            <BoardDelivery
              sprints={mockSprints}
              tasks={mockDeliveryTasks}
              releases={mockReleases}
              boardLabel="Sprint Board Demo"
              totalCols={6}
              availableProjects={['AUTH', 'DEVOPS']}
              containerProjectMap={{}}
              onContainerProjectChange={() => {}}
              onTaskUpdate={() => {}}
              onTaskDelete={() => {}}
              onTaskResize={() => {}}
              onTaskMove={() => {}}
              onNestTask={() => {}}
              onUnnestTask={() => {}}
              onAddTask={() => {}}
              jiraBaseUrl={null}
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
          message="Êtes-vous sûr de vouloir continuer ?"
          onConfirm={() => { setShowConfirm(false); addToast({ type: 'success', message: 'Confirmé !' }); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {showSharing && (
        <SharingModal
          resourceType="roadmap"
          resourceId="demo-resource"
          resourceName="Demo Design System"
          onClose={() => setShowSharing(false)}
          onUpdated={() => addToast({ type: 'info', message: 'Partage mis à jour' })}
        />
      )}

      <ToastContainer toasts={toasts} onClose={removeToast} />
    </Layout>
  );
}

export default function DesignSystemApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return <DesignSystemPage onNavigate={onNavigate} />;
}
