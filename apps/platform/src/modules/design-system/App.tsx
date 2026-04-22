import { useState, useCallback, type ReactNode, type CSSProperties } from 'react';
import {
  Layout, ModuleHeader, Modal, ConfirmModal, LoadingSpinner,
  Toast, ToastContainer, ListEditor, TagEditor, ExpandableSection,
  ImageUploader, Card, FormField,
  Badge, Button, ProjectEditor,
  SectionTitle, Tabs,
  SharingModal, VisibilityPicker,
  APPS,
} from '@boilerplate/shared/components';
import { STATUS_OPTIONS } from '../suivitess/types';
import type { ToastData, Visibility, ProjectItem } from '@boilerplate/shared/components';
import { GanttBoard } from '../roadmap/components/GanttBoard/GanttBoard';
import type { Task as RoadmapTask, Planning, Dependency, ViewMode, Marker } from '../roadmap/types';
import { BoardDelivery } from '../delivery/components/BoardDelivery';
import type { Sprint, Task as DeliveryTask, Release } from '../delivery/types';
import './App.css';

// ── Token data ──────────────────────────────────────────────────────────────

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
      { name: '--text-light', desc: 'Texte leger' },
      { name: '--text-inverse', desc: 'Texte inverse' },
    ],
  },
  { label: 'Accent',
    sub: 'Couleur principale de l\'app (cyan). Les modules peuvent surcharger --accent-primary localement.',
    tokens: [
      { name: '--accent-primary', desc: 'Accent principal (cyan)' },
      { name: '--accent-primary-hover', desc: 'Accent hover' },
      { name: '--accent-secondary', desc: 'Accent secondaire' },
      { name: '--accent-light', desc: 'Accent fond' },
    ],
  },
  { label: 'Bordures',
    sub: 'Séparateurs standards.',
    tokens: [
      { name: '--border-color', desc: 'Bordure standard' },
      { name: '--border-light', desc: 'Bordure legere' },
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
      { name: '--success', desc: 'Succes' },
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

// ── Promotion candidates (COMPONENTS.md §2) ─────────────────────────────────
// Module-local components that are de facto reusable. Should be promoted to
// `packages/shared/` when we converge. Listed here so the design-system page
// doubles as a "promotion backlog".
const PROMOTION_CANDIDATES: Array<{
  name: string;
  file: string;
  pattern: string;
  target: string;
  impact?: string;
}> = [
  {
    name: 'CustomDropdown',
    file: 'suivitess/components/BulkTranscriptionImportModal/*.tsx (helper)',
    pattern: "Dropdown avec chevron, mode compact inline, séparateurs, scroll intégré.",
    target: 'packages/shared/src/components/Dropdown/Dropdown.tsx',
    impact: '⭐⭐⭐',
  },
  {
    name: 'InlineNameEditor',
    file: 'suivitess/components/BulkTranscriptionImportModal/*.tsx (helper)',
    pattern: 'Input inline + bouton 🤖 (régénération IA) + ✓/✕ — pour édition de nom avec suggestion IA.',
    target: 'packages/shared/src/components/AISuggestInput/AISuggestInput.tsx',
  },
  {
    name: 'PipelineStepsIndicator',
    file: 'suivitess/components/BulkTranscriptionImportModal/*.tsx (helper)',
    pattern: "Liste d'étapes avec checkbox ⏳/✓ pilotée par événements t1/t2/t3.",
    target: 'packages/shared/src/components/StepsProgress/StepsProgress.tsx',
  },
  {
    name: 'CodeBlock',
    file: 'ai-logs/App.tsx + ai-playground/App.tsx + prompt-logs/App.tsx',
    pattern: 'Bloc <pre> avec syntax-highlight léger, bouton « copier » et métadonnées.',
    target: 'packages/shared/src/components/CodeBlock/CodeBlock.tsx',
    impact: '⭐⭐',
  },
  {
    name: 'CreditBadge',
    file: 'gateway/components/Dashboard/CreditBadge.tsx',
    pattern: 'Badge circulaire avec compteur + tooltip.',
    target: 'Fusion avec Badge (mode counter) — candidat faible.',
  },
  {
    name: 'RecentItemsCard / ModuleRecentBlock',
    file: 'gateway/components/Dashboard/ModuleRecentBlock.tsx',
    pattern: 'Card « N items récents » avec icône + date + lien.',
    target: 'packages/shared/src/components/RecentList/RecentList.tsx',
    impact: '⭐⭐',
  },
  {
    name: 'HeaderMenu',
    file: 'suivitess/App.tsx · delivery/App.tsx · mon-cv/App.tsx',
    pattern: 'Bouton avec chevron + menu absolu avec items + click-outside.',
    target: 'packages/shared/src/components/HeaderMenu/HeaderMenu.tsx (ou <details> natif).',
  },
  {
    name: 'EmptyState',
    file: 'delivery/BoardList · roadmap/PlanningList · mon-cv/CVListPage · suivitess/DocumentSelector',
    pattern: "Card centrée avec icône + titre + hint + bouton « Créer ».",
    target: 'packages/shared/src/components/EmptyState/EmptyState.tsx',
    impact: '⭐⭐',
  },
  {
    name: 'InlinePill',
    file: 'suivitess/components/BulkTranscriptionImportModal/*.tsx (classes .aiDecisionInlineDropdown)',
    pattern: "Pill coloré qui s'ouvre en dropdown inline dans une phrase + chevron discret + edit icon ✎.",
    target: 'packages/shared/src/components/InlinePill/InlinePill.tsx',
  },
  {
    name: 'SegmentedControl',
    file: 'delivery/JiraImportModal · conges/ViewControls · rag/ChatView',
    pattern: '2+ boutons collés en « onglets compacts » pour choisir un mode.',
    target: 'packages/shared/src/components/SegmentedControl/SegmentedControl.tsx',
    impact: '⭐⭐',
  },
];

// ── Module-local components (COMPONENTS.md §3) ──────────────────────────────
// Domain-specific components that stay local. Listed here as an index so
// developers can find a component by module.
const MODULE_LOCALS: Array<{
  module: string;
  color: string;
  components: Array<{ name: string; file: string; desc: string }>;
}> = [
  {
    module: 'SuiviTess',
    color: '#10b981',
    components: [
      { name: 'DocumentSelector', file: 'suivitess/components/DocumentSelector/', desc: 'Landing — liste + création de documents SuiviTess.' },
      { name: 'ReviewWizard', file: 'suivitess/components/ReviewWizard/', desc: 'Wizard multi-étapes pour composer une review.' },
      { name: 'TableOfContents', file: 'suivitess/components/TableOfContents/', desc: 'Sommaire latéral avec ancres de navigation.' },
      { name: 'SubjectReview', file: 'suivitess/components/SubjectReview/', desc: 'Détail d\'un sujet — édition + historique.' },
      { name: 'BulkTranscriptionImportModal', file: 'suivitess/components/BulkTranscriptionImportModal/', desc: 'Modale "Analyser & ranger" — pipeline IA multi-source.' },
      { name: 'SkillButton', file: 'suivitess/components/SkillButton/', desc: 'Bouton action + tooltip pipeline IA cliquable.' },
      { name: 'SubjectAnalysisModal', file: 'suivitess/components/SubjectAnalysisModal/', desc: 'Modale d\'analyse IA d\'un sujet isolé.' },
      { name: 'TicketCreateModal', file: 'suivitess/components/TicketCreateModal/', desc: 'Création de ticket Jira depuis un sujet.' },
      { name: 'EmailPreviewModal', file: 'suivitess/components/EmailPreviewModal/', desc: 'Prévisualisation + régénération d\'email IA.' },
      { name: 'RecorderBar', file: 'suivitess/components/RecorderBar/', desc: 'Barre d\'enregistrement audio (MediaRecorder).' },
      { name: 'HistoryPanel', file: 'suivitess/components/HistoryPanel/', desc: 'Panneau latéral historique des modifications.' },
      { name: 'Preview', file: 'suivitess/components/Preview/', desc: 'Aperçu d\'un sujet en mode lecture.' },
      { name: 'SuggestionsPanel', file: 'suivitess/components/SuggestionsPanel/', desc: 'Panneau de suggestions IA contextuelles.' },
    ],
  },
  {
    module: 'Roadmap',
    color: '#8b5cf6',
    components: [
      { name: 'GanttBoard', file: 'roadmap/components/GanttBoard/', desc: 'Diagramme de Gantt interactif (tasks + dependencies + markers).' },
      { name: 'TaskBar', file: 'roadmap/components/GanttBoard/TaskBar.tsx', desc: 'Barre de tâche (drag, resize, progress).' },
      { name: 'DependencyLines', file: 'roadmap/components/GanttBoard/DependencyLines.tsx', desc: 'Liens de dépendance SVG entre tâches.' },
      { name: 'MarkerLine', file: 'roadmap/components/GanttBoard/MarkerLine.tsx', desc: 'Ligne verticale de jalon (release, milestone).' },
      { name: 'TodayMarker', file: 'roadmap/components/GanttBoard/TodayMarker.tsx', desc: 'Ligne « aujourd\'hui » sur la timeline.' },
      { name: 'TaskForm', file: 'roadmap/components/TaskForm/', desc: 'Formulaire de création/édition d\'une tâche.' },
      { name: 'SubjectsPanel', file: 'roadmap/components/SubjectsPanel/', desc: 'Panneau latéral des sujets SuiviTess liés.' },
      { name: 'PlanningList', file: 'roadmap/components/PlanningList/', desc: 'Liste des plannings + CRUD.' },
      { name: 'PlanningForm', file: 'roadmap/components/PlanningList/PlanningForm.tsx', desc: 'Formulaire de planning (dates, visibilité).' },
      { name: 'ViewSelector', file: 'roadmap/components/ViewSelector/', desc: 'Bouton segmented jour/semaine/mois/trimestre.' },
    ],
  },
  {
    module: 'Delivery',
    color: '#ff9800',
    components: [
      { name: 'BoardDelivery', file: 'delivery/components/BoardDelivery.tsx', desc: 'Plateau sprint 6 semaines avec tâches positionnées.' },
      { name: 'BoardList', file: 'delivery/components/BoardList.tsx', desc: 'Liste des boards + création.' },
      { name: 'BoardRow / SprintColumn / TaskBlock', file: 'delivery/components/', desc: 'Primitives grille Delivery.' },
      { name: 'ReleaseMarker', file: 'delivery/components/ReleaseMarker.tsx', desc: 'Marqueur de release Jira sur le board.' },
      { name: 'JiraImportModal', file: 'delivery/components/JiraImportModal.tsx', desc: 'Import de tâches depuis Jira (par sprint ou URL).' },
      { name: 'ImportModal / LayoutRulesModal', file: 'delivery/components/', desc: 'Modales d\'import et règles d\'autolayout.' },
      { name: 'SanityCheckModal', file: 'delivery/components/SanityCheckModal.tsx', desc: 'Vérification IA de cohérence du board.' },
      { name: 'SnapshotModal / RestoreModal', file: 'delivery/components/', desc: 'Snapshots du board + restauration.' },
    ],
  },
  {
    module: 'Mon CV',
    color: '#6366f1',
    components: [
      { name: 'CVListPage', file: 'mon-cv/components/CVListPage/', desc: 'Liste des CV de l\'utilisateur.' },
      { name: 'MyProfilePage', file: 'mon-cv/components/MyProfilePage/', desc: 'Édition du profil de référence.' },
      { name: 'AdaptationsListPage', file: 'mon-cv/components/AdaptationsListPage/', desc: 'Historique des adaptations IA.' },
      { name: 'AdaptCVPage', file: 'mon-cv/components/AdaptCVPage/', desc: 'Adaptation d\'un CV à une offre (IA).' },
      { name: 'AdaptationDetailPage', file: 'mon-cv/components/AdaptationDetailPage/', desc: 'Détail d\'une adaptation + diff.' },
      { name: 'ImportCVModal', file: 'mon-cv/components/ImportCVModal/', desc: 'Import de CV (PDF, LinkedIn).' },
      { name: 'ExportSection', file: 'mon-cv/components/ExportSection/', desc: 'Export du CV (PDF / DOCX).' },
      { name: 'EmbedView', file: 'mon-cv/components/EmbedView/', desc: 'Vue embed publique du CV.' },
    ],
  },
  {
    module: 'Congés',
    color: '#ec4899',
    components: [
      { name: 'LeaveCalendar', file: 'conges/components/LeaveCalendar/', desc: 'Calendrier mensuel des congés équipe.' },
      { name: 'LeaveBar', file: 'conges/components/LeaveBar/', desc: 'Barre colorée représentant une absence.' },
      { name: 'LeaveForm', file: 'conges/components/LeaveForm/', desc: 'Formulaire de demande de congé.' },
      { name: 'Legend', file: 'conges/components/Legend/', desc: 'Légende des couleurs membres.' },
      { name: 'MemberList', file: 'conges/components/MemberList/', desc: 'Liste équipe + édition couleur.' },
      { name: 'ViewControls', file: 'conges/components/ViewControls/', desc: 'Sélecteur de période / type de vue.' },
    ],
  },
  {
    module: 'Assistant RAG',
    color: '#f59e0b',
    components: [
      { name: 'RagList', file: 'rag/components/RagList/', desc: 'Liste des bases de connaissance.' },
      { name: 'RagDetail', file: 'rag/components/RagDetail/', desc: 'Détail d\'une base + sources indexées.' },
      { name: 'RagForm', file: 'rag/components/RagForm/', desc: 'Création / édition d\'une base RAG.' },
      { name: 'ChatView', file: 'rag/components/ChatView/', desc: 'Vue chat avec streaming + citations.' },
      { name: 'ConversationList', file: 'rag/components/ConversationList/', desc: 'Liste des conversations précédentes.' },
      { name: 'IndexModal', file: 'rag/components/IndexModal/', desc: 'Modale d\'indexation de sources (URL / fichiers).' },
      { name: 'SourcesPanel', file: 'rag/components/SourcesPanel/', desc: 'Panneau latéral des sources d\'une réponse.' },
      { name: 'EmbedChat / EmbedChatPage', file: 'rag/components/EmbedChat/', desc: 'Version embed publique du chat.' },
    ],
  },
  {
    module: 'Gateway (core)',
    color: '#00bcd4',
    components: [
      { name: 'LandingPage', file: 'gateway/components/LandingPage.tsx', desc: 'Page d\'accueil publique.' },
      { name: 'Dashboard', file: 'gateway/components/Dashboard/', desc: 'Dashboard authentifié — modules + récent.' },
      { name: 'ModuleRecentBlock', file: 'gateway/components/Dashboard/ModuleRecentBlock.tsx', desc: 'Card "items récents" par module.' },
      { name: 'QuickActionsSection', file: 'gateway/components/Dashboard/QuickActionsSection.tsx', desc: 'Raccourcis d\'actions fréquentes.' },
      { name: 'CreditBadge', file: 'gateway/components/Dashboard/CreditBadge.tsx', desc: 'Badge crédits IA restants.' },
      { name: 'LoginPage / RegisterPage', file: 'gateway/components/', desc: 'Pages d\'authentification.' },
      { name: 'ConnectorsPage', file: 'gateway/components/ConnectorsPage.tsx', desc: 'Connecteurs IA + collecteurs (Slack / Outlook).' },
      { name: 'SettingsPage', file: 'gateway/components/SettingsPage/', desc: 'Réglages utilisateur.' },
      { name: 'AdminPage + AdminAiSkillsSection + AdminLegacyBulletsSection', file: 'gateway/components/', desc: 'Page admin générale + sous-sections.' },
    ],
  },
  {
    module: 'Admin (pages autonomes)',
    color: '#6b7280',
    components: [
      { name: 'ai-logs', file: 'modules/ai-logs/App.tsx', desc: 'Logs des appels IA (prompts + réponses).' },
      { name: 'ai-evals', file: 'modules/ai-evals/App.tsx', desc: 'Évaluations automatisées des skills.' },
      { name: 'ai-playground', file: 'modules/ai-playground/App.tsx', desc: 'Playground pour tester les skills.' },
      { name: 'prompt-logs', file: 'modules/prompt-logs/App.tsx', desc: 'Logs prompts système + hooks externes.' },
      { name: 'admin-features', file: 'modules/admin-features/App.tsx', desc: 'Feature flags administrables.' },
      { name: 'ai-improve-assistant', file: 'modules/ai-improve-assistant/App.tsx', desc: 'Assistant d\'amélioration de skill IA (9 étapes).' },
      { name: 'design-system', file: 'modules/design-system/App.tsx', desc: 'Cette page — showcase du design system.' },
    ],
  },
];

// ── Mock data for module component demos ────────────────────────────────────

const now = new Date().toISOString();

// Narrow 3-month window starting today so all tasks + dependencies are
// visible without horizontal scrolling (GanttBoard auto-scrolls to today).
const mockPlanning: Planning = {
  id: 'demo-1', name: 'Q2 Roadmap', description: 'Planning demo',
  startDate: '2026-04-22', endDate: '2026-07-31',
  createdAt: now, updatedAt: now,
};

// Roadmap tasks — FLAT array (GanttBoard reconstructs the tree via parentId).
// Structure matching production `buildEnhancedTasks`:
//   1. Virtual "Delivery" overlay FIRST, grey (#7280a0), with `sortOrder: -1`
//      and its compact Jira leaves (color driven by simpleStatus).
//   2. Real roadmap tasks below — parent/children share the same color, dates
//      chosen so that finish-to-start dependencies flow forward cleanly.
const mockRoadmapTasks: RoadmapTask[] = [
  // ─── Virtual delivery overlay (grey, always on top) ───
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

  // ─── Real roadmap tasks ───
  // Parent "Design System" + 3 children — dependencies flow forward
  { id: 'rt1',  planningId: 'demo-1', parentId: null,  name: 'Design System',           description: 'Tokens + composants partagés', startDate: '2026-04-22', endDate: '2026-05-31', color: '#00bcd4', progress: 60, sortOrder: 0, createdAt: now, updatedAt: now },
  { id: 'rt1a', planningId: 'demo-1', parentId: 'rt1', name: 'Tokens (couleurs, typo)', description: null,                           startDate: '2026-04-22', endDate: '2026-05-06', color: '#00bcd4', progress: 80,  sortOrder: 0, createdAt: now, updatedAt: now },
  { id: 'rt1b', planningId: 'demo-1', parentId: 'rt1', name: 'Composants forms',        description: null,                           startDate: '2026-05-09', endDate: '2026-05-22', color: '#00bcd4', progress: 30, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: 'rt1c', planningId: 'demo-1', parentId: 'rt1', name: 'Showcase page',           description: null,                           startDate: '2026-05-25', endDate: '2026-05-31', color: '#00bcd4', progress: 0,  sortOrder: 2, createdAt: now, updatedAt: now },

  // Parent "API v2" + 2 children
  { id: 'rt2',  planningId: 'demo-1', parentId: null,  name: 'API v2',          description: "Refonte de l'API publique", startDate: '2026-06-03', endDate: '2026-07-05', color: '#8b5cf6', progress: 0, sortOrder: 1, createdAt: now, updatedAt: now },
  { id: 'rt2a', planningId: 'demo-1', parentId: 'rt2', name: 'Auth refactor',   description: null,                        startDate: '2026-06-03', endDate: '2026-06-17', color: '#8b5cf6', progress: 0, sortOrder: 0, createdAt: now, updatedAt: now },
  { id: 'rt2b', planningId: 'demo-1', parentId: 'rt2', name: 'Rate limiting',   description: null,                        startDate: '2026-06-22', endDate: '2026-07-05', color: '#8b5cf6', progress: 0, sortOrder: 1, createdAt: now, updatedAt: now },

  // Standalone leaf
  { id: 'rt3',  planningId: 'demo-1', parentId: null,  name: 'Tests E2E Playwright', description: null, startDate: '2026-07-08', endDate: '2026-07-25', color: '#4caf50', progress: 0, sortOrder: 2, createdAt: now, updatedAt: now },
];

// Dependencies between tasks (finish-to-start — source ends, target starts).
// Dates above are choosen to give each dependency a forward-flowing arrow.
const mockDependencies: Dependency[] = [
  { id: 'd1', fromTaskId: 'rt1a', toTaskId: 'rt1b', type: 'finish-to-start', createdAt: now },
  { id: 'd2', fromTaskId: 'rt1b', toTaskId: 'rt1c', type: 'finish-to-start', createdAt: now },
  { id: 'd3', fromTaskId: 'rt2a', toTaskId: 'rt2b', type: 'finish-to-start', createdAt: now },
  { id: 'd4', fromTaskId: 'rt2',  toTaskId: 'rt3',  type: 'finish-to-start', createdAt: now },
];

// Markers — vertical milestone lines on the timeline.
const mockMarkers: Marker[] = [
  { id: 'm1', planningId: 'demo-1', name: 'MEP v1.5',        markerDate: '2026-05-20', color: '#3b82f6', type: 'milestone', taskId: null, createdAt: now, updatedAt: now },
  { id: 'm2', planningId: 'demo-1', name: 'Release v2',      markerDate: '2026-06-30', color: '#f44336', type: 'milestone', taskId: null, createdAt: now, updatedAt: now },
  { id: 'm3', planningId: 'demo-1', name: 'Revue trimestre', markerDate: '2026-07-20', color: '#10b981', type: 'milestone', taskId: null, createdAt: now, updatedAt: now },
];

// 6-week sprint window starting today to visualize a real delivery board.
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

// Releases — multi-projet pour démontrer les marqueurs colorés par projet Jira.
const mockReleases: Release[] = [
  { id: 'r1', date: '2026-04-26', version: 'v1.5',  projectKey: 'AUTH',   color: '#3b82f6' },
  { id: 'r2', date: '2026-05-10', version: 'v2.0',  projectKey: 'AUTH',   color: '#3b82f6' },
  { id: 'r3', date: '2026-05-20', version: '24.04', projectKey: 'DEVOPS', color: '#f59e0b' },
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

function RawColorSwatch({ value, label, gradientEnd }: { value: string; label: string; gradientEnd?: string }) {
  const bg = gradientEnd
    ? `linear-gradient(135deg, ${value}, ${gradientEnd})`
    : value;
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
  const [projects, setProjects] = useState<ProjectItem[]>([
    { title: 'Projet Alpha', description: 'Refonte du design system' },
    { title: 'Projet Beta', description: 'Migration API v2' },
  ]);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [showSharing, setShowSharing] = useState(false);
  const [themeAppId, setThemeAppId] = useState<string>(APPS[0]?.id ?? '');
  const themeApp = APPS.find(a => a.id === themeAppId) ?? APPS[0];

  return (
    <Layout appId="design-system" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader title="Design System" onBack={() => onNavigate?.('/')} />
      <div className="ds-page">

        {/* ── Intro ── */}
        <section className="ds-section">
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 'var(--spacing-sm)' }}>
            Référence visuelle des composants partagés exposés par{' '}
            <code>@boilerplate/shared/components</code>. Cartographie complète + plan de
            convergence dans <code>COMPONENTS.md</code>.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Convention : tout composant utilisé par ≥ 2 modules doit vivre dans{' '}
            <code>packages/shared/</code>. Les tokens ci-dessous s'appliquent à toute
            l'application via <code>packages/shared/src/styles/theme.css</code>.
          </p>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            PARTIE 1 — DESIGN SYSTEM (tokens + composants shared)
            ══════════════════════════════════════════════════════════════════ */}
        <div className="ds-part-header">
          <h2 className="ds-part-title">1. Design System</h2>
          <p className="ds-part-sub">
            Tokens globaux et composants partagés exposés par{' '}
            <code>@boilerplate/shared/components</code>. Référence à utiliser
            systématiquement avant de recréer un composant.
          </p>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            TOKENS
            ══════════════════════════════════════════════════════════════════ */}

        {/* ── Colors ── */}
        <section className="ds-section">
          <SectionTitle>Couleurs</SectionTitle>
          {COLORS.map(group => (
            <div key={group.label} className="ds-color-group">
              <h3 className="ds-group-label">{group.label}</h3>
              {group.sub && <p className="ds-group-sub">{group.sub}</p>}
              <div className="ds-swatches">
                {group.tokens.map(t => <ColorSwatch key={t.name} name={t.name} desc={t.desc} />)}
              </div>
            </div>
          ))}
          {/* Per-module brand colors — exposed via `APPS` from shared,
              used by SharedNav bullets, dashboards, and gradient fills. */}
          <div className="ds-color-group">
            <h3 className="ds-group-label">Modules</h3>
            <p className="ds-group-sub">
              Couleurs de marque des applications — source : <code>APPS</code> dans
              <code> @boilerplate/shared</code>. Utilisées pour les pastilles de la{' '}
              <code>SharedNav</code>, les icônes dashboard et les gradients landing.
            </p>
            <div className="ds-swatches">
              {APPS.map(app => (
                <RawColorSwatch
                  key={app.id}
                  value={app.color}
                  gradientEnd={app.gradientEnd}
                  label={app.name}
                />
              ))}
            </div>
          </div>
          {/* ModeTag colors — used by the SuiviTess routing review to
              distinguish "new" vs "update" subjects. */}
          <div className="ds-color-group">
            <h3 className="ds-group-label">ModeTag</h3>
            <p className="ds-group-sub">
              Spécifique à <code>SuiviTess</code> — distingue les sujets « créés »
              (jaune) des « mises à jour » (bleu) dans la modale d'import routing.
            </p>
            <div className="ds-swatches">
              <RawColorSwatch value="#eab308" label="+ Nouveau" />
              <RawColorSwatch value="#3b82f6" label="Mise à jour" />
            </div>
          </div>
          {/* StatusTag colors — source of truth: STATUS_OPTIONS in
              modules/suivitess/types/index.ts. */}
          <div className="ds-color-group">
            <h3 className="ds-group-label">StatusTag</h3>
            <p className="ds-group-sub">
              Spécifique à <code>SuiviTess</code> — états métier des sujets. Source :{' '}
              <code>STATUS_OPTIONS</code> dans <code>modules/suivitess/types</code>. Utilisées
              pour les badges de statut, bordures de bloc sujet et fonds des items résumé.
            </p>
            <div className="ds-swatches">
              {STATUS_OPTIONS.map(opt => (
                <RawColorSwatch key={opt.value} value={opt.color} label={opt.label} />
              ))}
            </div>
          </div>
        </section>

        {/* ── Couleur principale du module ── */}
        <section className="ds-section">
          <SectionTitle>Couleur principale du module</SectionTitle>
          <p className="ds-section-sub">
            Chaque module possède une <strong>couleur de marque</strong> (définie dans
            <code> APPS</code>) qui surcharge <code>--accent-primary</code> pour tous les
            composants à l'intérieur de ce module. Le composant <code>Layout</code>{' '}
            injecte la couleur en inline-style sur son wrapper, ce qui fait cascader la
            valeur vers tous les enfants qui utilisent <code>var(--accent-primary)</code>{' '}
            (boutons, hover, focus ring, bordures actives, etc.).
          </p>
          <div className="ds-color-group">
            <h3 className="ds-group-label">Aperçu interactif</h3>
            <p className="ds-group-sub">
              Sélectionne un module — tous les éléments ci-dessous héritent
              instantanément de sa couleur principale via <code>--accent-primary</code>.
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
                    style={{
                      ['--module-color' as string]: app.color,
                      ['--module-gradient-end' as string]: app.gradientEnd,
                    } as CSSProperties}
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
                <strong style={{ color: 'var(--accent-primary)' }}>
                  {themeApp.name}
                </strong>
                <code className="ds-theme-preview-hex">
                  --accent-primary: {themeApp.color} · --accent-primary-hover: {themeApp.gradientEnd}
                </code>
              </div>

              <div className="ds-theme-preview-grid">
                {/* Boutons */}
                <div className="ds-theme-preview-block">
                  <span className="ds-theme-preview-label">Boutons</span>
                  <div className="ds-comp-row">
                    <Button variant="primary">Action principale</Button>
                    <Button variant="secondary">Secondaire</Button>
                  </div>
                </div>

                {/* Badge accent */}
                <div className="ds-theme-preview-block">
                  <span className="ds-theme-preview-label">Badge accent</span>
                  <div className="ds-comp-row">
                    <Badge type="accent">Accent</Badge>
                    <Badge type="success">Succès</Badge>
                  </div>
                </div>

                {/* Loader */}
                <div className="ds-theme-preview-block">
                  <span className="ds-theme-preview-label">Loader</span>
                  <div className="ds-comp-row">
                    <LoadingSpinner size="sm" />
                    <LoadingSpinner />
                  </div>
                </div>

                {/* Focus state */}
                <div className="ds-theme-preview-block">
                  <span className="ds-theme-preview-label">Focus</span>
                  <input
                    type="text"
                    placeholder="Clique pour voir le focus ring"
                    className="ds-theme-preview-input"
                  />
                </div>

                {/* Lien accent */}
                <div className="ds-theme-preview-block">
                  <span className="ds-theme-preview-label">Lien accentué</span>
                  <a
                    href="#"
                    onClick={e => e.preventDefault()}
                    style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
                  >
                    Consulter la documentation →
                  </a>
                </div>

                {/* Bordure active */}
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

              <pre className="ds-theme-preview-code">
                <code>{`<Layout appId="${themeApp.id}" variant="full-width">
  {/* --accent-primary est surchargé à ${themeApp.color}
     pour tous les enfants du Layout */}
</Layout>`}</code>
              </pre>
            </div>
          </div>
        </section>

        {/* ── Typography ── */}
        <section className="ds-section">
          <SectionTitle>Typographie</SectionTitle>

          {/* Sub-group: heading levels H1 → H6 */}
          <div className="ds-color-group">
            <h3 className="ds-group-label">Titres H1 – H6</h3>
            <p className="ds-group-sub">
              Hiérarchie des titres HTML — styles par défaut du navigateur, surchargés
              dans chaque module si besoin via la classe du conteneur.
            </p>
            <div className="ds-typo-samples">
              <div className="ds-typo-row">
                <span className="ds-typo-label">H1</span>
                <h1 className="ds-typo-sample" style={{ margin: 0 }}>Titre principal — H1</h1>
              </div>
              <div className="ds-typo-row">
                <span className="ds-typo-label">H2</span>
                <h2 className="ds-typo-sample" style={{ margin: 0 }}>Titre de section — H2</h2>
              </div>
              <div className="ds-typo-row">
                <span className="ds-typo-label">H3</span>
                <h3 className="ds-typo-sample" style={{ margin: 0 }}>Sous-titre — H3</h3>
              </div>
              <div className="ds-typo-row">
                <span className="ds-typo-label">H4</span>
                <h4 className="ds-typo-sample" style={{ margin: 0 }}>Sous-section — H4</h4>
              </div>
              <div className="ds-typo-row">
                <span className="ds-typo-label">H5</span>
                <h5 className="ds-typo-sample" style={{ margin: 0 }}>Niveau 5 — H5</h5>
              </div>
              <div className="ds-typo-row">
                <span className="ds-typo-label">H6</span>
                <h6 className="ds-typo-sample" style={{ margin: 0 }}>Niveau 6 — H6</h6>
              </div>
            </div>
          </div>

          {/* Sub-group: font-size tokens (primitive scale used by shared components) */}
          <div className="ds-color-group">
            <h3 className="ds-group-label">Tailles de police (tokens)</h3>
            <p className="ds-group-sub">
              Échelle primitive utilisée par les composants partagés via{' '}
              <code>var(--font-size-*)</code>.
            </p>
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
        <section className="ds-section">
          <SectionTitle>Espacements</SectionTitle>
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
          <SectionTitle>Rayons de bordure</SectionTitle>
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
          <SectionTitle>Ombres</SectionTitle>
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
          <SectionTitle>Bouton</SectionTitle>
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
          <SectionTitle>Titre de section</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; SectionTitle</p>
          <SectionTitle>Exemple d'utilisation</SectionTitle>
        </section>

        {/* ── Tabs ── */}
        <section className="ds-section">
          <SectionTitle>Onglets</SectionTitle>
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
          <SectionTitle>Carte</SectionTitle>
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
          <SectionTitle>Champ de formulaire</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; FormField</p>

          {/* States — neutral, required, with dynamic error */}
          <div className="ds-color-group">
            <h3 className="ds-group-label">États par défaut</h3>
            <p className="ds-group-sub">
              Variantes standards : champ neutre, obligatoire (*), et avec validation
              dynamique (saisir moins de 3 caractères pour déclencher l'erreur).
            </p>
            <div className="ds-form-demo">
              <FormField label="Nom" required>
                <input
                  type="text"
                  value={formName}
                  onChange={e => {
                    setFormName(e.target.value);
                    setFormError(e.target.value.length < 3 && e.target.value.length > 0 ? '3 caractères minimum' : '');
                  }}
                  placeholder="Entrez un nom…"
                />
              </FormField>
              <FormField label="Email">
                <input type="email" placeholder="email@exemple.com" />
              </FormField>
              {formError && (
                <FormField label="Validation dynamique" error={formError}>
                  <input type="text" value={formName} readOnly />
                </FormField>
              )}
            </div>
          </div>

          {/* Error catalog — permanent examples covering the common cases */}
          <div className="ds-color-group">
            <h3 className="ds-group-label">Messages d'erreur</h3>
            <p className="ds-group-sub">
              Exemples permanents des messages d'erreur courants — bordure rouge +
              message sous le champ via la prop <code>error</code>.
            </p>
            <div className="ds-form-demo">
              <FormField label="Champ requis" required error="Ce champ est obligatoire">
                <input type="text" placeholder="Saisissez une valeur…" />
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
              <FormField label="Liste déroulante" required error="Veuillez sélectionner une option">
                <select defaultValue="">
                  <option value="" disabled>— Choisir —</option>
                  <option value="a">Option A</option>
                  <option value="b">Option B</option>
                </select>
              </FormField>
              <FormField label="Unicité" error="Ce nom est déjà utilisé">
                <input type="text" defaultValue="admin" />
              </FormField>
              <FormField label="Erreur serveur" error="Erreur serveur — veuillez réessayer dans un instant">
                <input type="text" defaultValue="valeur saisie" />
              </FormField>
            </div>
          </div>
        </section>

        {/* ── ListEditor ── */}
        <section className="ds-section">
          <SectionTitle>Éditeur de liste</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; ListEditor</p>
          <div className="ds-comp-constrained">
            <ListEditor items={listItems} onChange={setListItems} label="Missions" placeholder="Ajouter une mission..." />
          </div>
        </section>

        {/* ── TagEditor ── */}
        <section className="ds-section">
          <SectionTitle>Éditeur de tags</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; TagEditor</p>
          <div className="ds-comp-constrained">
            <TagEditor tags={tags} onChange={setTags} label="Technologies" placeholder="Ajouter un tag..." />
          </div>
        </section>

        {/* ── ProjectEditor ── */}
        <section className="ds-section">
          <SectionTitle>Éditeur de projets</SectionTitle>
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
          <SectionTitle>Section pliable</SectionTitle>
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
          <SectionTitle>Uploader d'image</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; ImageUploader</p>
          <div className="ds-comp-constrained">
            <ImageUploader image={profileImage || undefined} onChange={setProfileImage} label="Photo de profil" size="medium" />
          </div>
        </section>

        {/* ── LoadingSpinner ── */}
        <section className="ds-section">
          <SectionTitle>Indicateur de chargement</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; LoadingSpinner</p>
          <div className="ds-comp-row">
            <LoadingSpinner size="sm" />
            <LoadingSpinner />
          </div>
        </section>

        {/* ── Modal / ConfirmModal ── */}
        <section className="ds-section">
          <SectionTitle>Modale / Modale de confirmation</SectionTitle>
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
          <SectionTitle>En-tête de module</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; ModuleHeader</p>
          <div className="ds-comp-constrained ds-module-header-demo" style={{ border: '1px solid var(--border-color)' }}>
            <ModuleHeader title="Titre du module" subtitle="Sous-titre" onBack={() => addToast({ type: 'info', message: 'Retour clique' })}>
              <Button variant="secondary">Action 1</Button>
              <Button variant="primary">Action 2</Button>
            </ModuleHeader>
          </div>
        </section>

        {/* ── VisibilityPicker ── */}
        <section className="ds-section">
          <SectionTitle>Sélecteur de visibilité</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; VisibilityPicker</p>
          <div className="ds-comp-constrained">
            <VisibilityPicker value={visibility} onChange={setVisibility} />
            <p style={{ marginTop: 'var(--spacing-sm)', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)' }}>
              Valeur actuelle : <code>{visibility}</code>
            </p>
          </div>
        </section>

        {/* ── SharingModal ── */}
        <section className="ds-section">
          <SectionTitle>Modale de partage</SectionTitle>
          <p className="ds-component-path">@boilerplate/shared/components &rarr; SharingModal</p>
          <div className="ds-comp-row">
            <Button variant="primary" onClick={() => setShowSharing(true)}>Ouvrir SharingModal</Button>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', marginTop: 'var(--spacing-xs)' }}>
            Modal complète (visibilité + emails invités) utilisée par roadmap, delivery,
            suivitess. Charge les données depuis <code>/api/&lt;resourceType&gt;/&lt;id&gt;/sharing</code>.
          </p>
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            COMPOSANTS MODULES (demos avec mock data)
            ══════════════════════════════════════════════════════════════════ */}

        <div className="ds-part-header ds-part-header--sub">
          <h3 className="ds-part-subtitle">Démos de composants module (shared avec mocks)</h3>
          <p className="ds-part-sub">
            Composants partagés mais non encore portés dans <code>packages/shared/</code>,
            démontrés ici avec des données fictives.
          </p>
        </div>

        {/* ── Gantt Board (Roadmap) ── */}
        <section className="ds-section">
          <SectionTitle>Diagramme de Gantt (Roadmap)</SectionTitle>
          <p className="ds-component-path">modules/roadmap/components/GanttBoard</p>
          <p className="ds-section-sub">
            Diagramme interactif — dernière version avec support des markers
            (jalons), tâches hiérarchiques (parent/enfant), dépendances et modes
            d'affichage (jour / semaine / mois / trimestre).
          </p>
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

        {/* ── Delivery Board ── */}
        <section className="ds-section">
          <SectionTitle>Plateau Delivery</SectionTitle>
          <p className="ds-component-path">modules/delivery/components/BoardDelivery</p>
          <p className="ds-section-sub">
            Plateau sprint — dernière version avec colonnes dynamiques
            (<code>totalCols</code>), marqueurs de release par projet Jira
            (<code>projectKey</code>), tâches sourcées (<code>manual</code> /
            <code> jira</code>) et containers de nesting.
          </p>
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

        {/* ══════════════════════════════════════════════════════════════════
            PARTIE 2 — COMPOSANTS (module-local + candidats à promotion)
            ══════════════════════════════════════════════════════════════════ */}
        <div className="ds-part-header">
          <h2 className="ds-part-title">2. Composants</h2>
          <p className="ds-part-sub">
            Cartographie des composants React du projet — candidats à promouvoir dans le
            design system et composants locaux par module. Source de vérité :{' '}
            <code>COMPONENTS.md</code>.
          </p>
        </div>

        {/* ── §2.1 Candidats à promotion ── */}
        <section className="ds-section">
          <SectionTitle>2.1 · Candidats à promotion</SectionTitle>
          <p className="ds-section-sub">
            Composants vivant dans un module mais réimplémentant un pattern générique.
            Doivent remonter dans <code>packages/shared/</code> pour éviter la duplication.
          </p>
          <div className="ds-candidates">
            {PROMOTION_CANDIDATES.map(c => (
              <div key={c.name} className="ds-candidate">
                <div className="ds-candidate-header">
                  <span className="ds-candidate-name">{c.name}</span>
                  {c.impact && <span className="ds-candidate-impact">{c.impact}</span>}
                </div>
                <p className="ds-candidate-pattern">{c.pattern}</p>
                <p className="ds-candidate-meta">
                  <span className="ds-candidate-label">Fichier</span>
                  <code>{c.file}</code>
                </p>
                <p className="ds-candidate-meta">
                  <span className="ds-candidate-label">Cible</span>
                  <code>{c.target}</code>
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── §2.2 Composants locaux par module ── */}
        <section className="ds-section">
          <SectionTitle>2.2 · Composants locaux par module</SectionTitle>
          <p className="ds-section-sub">
            Composants spécifiques à un domaine métier — restent dans le module. Liste
            donnée ici comme index pour faciliter leur localisation.
          </p>
          {MODULE_LOCALS.map(block => (
            <div key={block.module} className="ds-module-block">
              <h3 className="ds-module-title" style={{ borderLeftColor: block.color }}>
                <span className="ds-module-dot" style={{ background: block.color }} />
                {block.module}
                <span className="ds-module-count">
                  ({block.components.length} composant{block.components.length > 1 ? 's' : ''})
                </span>
              </h3>
              <div className="ds-module-grid">
                {block.components.map(c => (
                  <div key={c.name} className="ds-module-item">
                    <div className="ds-module-item-name">{c.name}</div>
                    <div className="ds-module-item-desc">{c.desc}</div>
                    <code className="ds-module-item-file">{c.file}</code>
                  </div>
                ))}
              </div>
            </div>
          ))}
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
