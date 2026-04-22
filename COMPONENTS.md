# Composants React — Cartographie & Convergence Shared

**Objectif** : converger vers une utilisation systématique du design system
`packages/shared/`. Ce document classe les composants en **3 niveaux** :

1. **✅ Shared DS** — déjà dans `packages/shared/`, à utiliser partout.
2. **⚠️ Candidats à promotion** — vivent dans un module mais sont *de facto*
   réutilisables (pattern identique répliqué ailleurs). À faire remonter
   dans `packages/shared/`.
3. **🔒 Locaux légitimes** — spécifiques à un module, pas de valeur en
   mutualisant.

---

# 1. ✅ Design System partagé (`packages/shared`)

Exporté via `packages/shared/src/components/index.ts`. **Référence à utiliser
systématiquement** avant de recréer un composant.

## Layout

| Composant        | Fichier                                                      | Utilité                                                          | Pris par                              |
| ---------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------- |
| `Layout`         | `Layout/Layout.tsx`                                          | Wrapper page module (SharedNav + main + variantes).              | Tous les modules (12+).               |
| `SharedNav`      | `SharedNav/SharedNav.tsx`                                    | Nav principale + toggle thème + admin drawer.                    | `router.tsx`, via `Layout`.           |
| `ModuleHeader`   | `ModuleHeader/ModuleHeader.tsx`                              | Header avec titre + back button + slot actions.                  | 8+ pages.                             |

## Forms

| Composant       | Fichier                                | Utilité                                                        | Pris par                        |
| --------------- | -------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| `Button`        | `Button/Button.tsx`                    | Bouton (primary/secondary/danger, tailles sm/md/lg).           | Partout.                        |
| `Modal`         | `Modal/Modal.tsx`                      | Modale (overlay + escape + tailles md/lg/xl).                  | 12+ usages.                     |
| `ConfirmModal`  | `ConfirmModal/ConfirmModal.tsx`        | Confirmation Oui/Non + mode `danger`.                          | 7+ usages.                      |
| `FormField`     | `FormField/FormField.tsx`              | Label + input + erreur standardisé.                            | 5+ formulaires.                 |
| `ListEditor`    | `ListEditor/ListEditor.tsx`            | CRUD d'une liste d'items.                                      | mon-cv seulement.               |
| `TagEditor`     | `TagEditor/TagEditor.tsx`              | Tags drag-drop + clavier.                                      | mon-cv seulement.               |
| `ImageUploader` | `ImageUploader/ImageUploader.tsx`      | Upload image drag-drop + preview.                              | mon-cv seulement.               |
| `ProjectEditor` | `ProjectEditor/ProjectEditor.tsx`      | Éditeur projets (titre + description + ordre).                 | mon-cv seulement.               |

> Les 4 derniers `*Editor`/`ImageUploader` sont dans shared mais utilisés
> *uniquement* par `mon-cv`. À regrouper plus tard sous
> `packages/shared/src/components/CVEditors/` ou à rapatrier dans
> `mon-cv/components/` si aucune autre adoption n'est prévue.

## Feedback

| Composant         | Fichier                                         | Utilité                                       | Pris par                        |
| ----------------- | ----------------------------------------------- | --------------------------------------------- | ------------------------------- |
| `Toast`           | `Toast/Toast.tsx`                               | Notif temporaire (success/error/info/warn).   | 8+ modules.                     |
| `ToastContainer`  | `Toast/Toast.tsx`                               | File d'affichage des toasts.                  | 8+ modules.                     |
| `LoadingSpinner`  | `LoadingSpinner/LoadingSpinner.tsx`             | Spinner (sm/md/lg/fullPage).                  | Partout.                        |

## Data display

| Composant           | Fichier                                          | Utilité                                              | Pris par                             |
| ------------------- | ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------ |
| `Card`              | `Card/Card.tsx`                                  | Conteneur (default/compact/interactive + selected).  | 10+ modules.                         |
| `Badge`             | `Badge/Badge.tsx`                                | Label coloré (success/warn/error/info/accent).       | 3 usages (sous-utilisé, voir §2).    |
| `ExpandableSection` | `ExpandableSection/ExpandableSection.tsx`        | Section pliable + badge de compte.                   | mon-cv + delivery.                   |
| `Tabs`              | `Tabs/Tabs.tsx`                                  | Onglets click-to-switch.                             | suivitess + gateway.                 |
| `SectionTitle`      | `SectionTitle/SectionTitle.tsx`                  | Titre section + sous-titre.                          | 4 usages gateway admin.              |
| `Hero`              | `Hero/Hero.tsx`                                  | Hero landing (titre + CTA + image).                  | demo uniquement.                     |
| `StatCounter`       | `StatCounter/StatCounter.tsx`                    | Stats (valeur + label).                              | demo uniquement.                     |
| `Footer`            | `Footer/Footer.tsx`                              | Pied de page (liens + copyright).                    | demo uniquement.                     |

## Auth & Sharing

| Composant          | Fichier                                                | Utilité                                                  | Pris par                             |
| ------------------ | ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------ |
| `SharingModal`     | `SharingModal/SharingModal.tsx`                        | Modal de partage (visibilité + emails invités).          | roadmap + delivery + suivitess.      |
| `VisibilityPicker` | `SharingModal/VisibilityPicker.tsx`                    | Switch private/public pour une ressource.                | roadmap + delivery + suivitess.      |

---

# 2. ⚠️ Candidats à promotion vers `packages/shared/`

Composants vivant dans un module mais **réimplémentant un pattern générique**.
Doivent remonter pour éviter la duplication et standardiser l'UX.

### `CustomDropdown` (suivitess)
- **Fichier** : `apps/platform/src/modules/suivitess/components/BulkTranscriptionImportModal/BulkTranscriptionImportModal.tsx` (helper interne)
- **Pattern** : dropdown avec chevron, mode compact inline, support séparateurs, scroll intégré.
- **Réutilisations potentielles** : delivery `JiraImportModal` (segmented), gateway `ConnectorsPage` (sélecteurs de provider), mon-cv (pickers).
- **Promotion** : `packages/shared/src/components/Dropdown/Dropdown.tsx`.

### `InlineNameEditor` (suivitess)
- **Fichier** : `BulkTranscriptionImportModal.tsx` (helper interne)
- **Pattern** : input inline + bouton 🤖 (régénération IA) + ✓/✕ — utile dès qu'on veut éditer un nom avec proposition IA.
- **Promotion** : `packages/shared/src/components/AISuggestInput/AISuggestInput.tsx` + prop `suggestEndpoint`.

### `PipelineStepsIndicator` (suivitess)
- **Fichier** : `BulkTranscriptionImportModal.tsx` (helper interne)
- **Pattern** : liste d'étapes avec checkbox ⏳/✓ pilotée par événements t1/t2/t3.
- **Réutilisations potentielles** : ai-playground (multi-skill run), ai-evals (experiment progress), delivery (import Jira avec N sprints).
- **Promotion** : `packages/shared/src/components/StepsProgress/StepsProgress.tsx`.

### `CodeBlock` / bloc prompts (ai-logs, ai-playground, prompt-logs)
- **Fichier** : dupliqué dans `ai-logs/App.tsx`, `ai-playground/App.tsx`, `prompt-logs/App.tsx`.
- **Pattern** : bloc `<pre>` avec syntax-highlight-léger + bouton "copier" + ligne/colonne de métadonnées.
- **Promotion** : `packages/shared/src/components/CodeBlock/CodeBlock.tsx`.

### `CreditBadge` (gateway/Dashboard)
- **Fichier** : `apps/platform/src/modules/gateway/components/Dashboard/CreditBadge.tsx`
- **Pattern** : badge circulaire avec compteur + tooltip.
- **Candidat faible** — pourrait être fusionné avec `Badge` en ajoutant un mode `counter`.

### `RecentItemsCard` (gateway/Dashboard `ModuleRecentBlock`)
- **Fichier** : `Dashboard/ModuleRecentBlock.tsx`
- **Pattern** : card "N items récents" avec icône + date + lien.
- **Réutilisations potentielles** : landing module (list récentes), admin-features (records récemment togglés).
- **Promotion** : `packages/shared/src/components/RecentList/RecentList.tsx`.

### Pattern "DropdownMenu" du header (suivitess actions, delivery board switcher, mon-cv export)
- **Fichiers** :
  - `suivitess/App.tsx` (Actions, Imports, Exports)
  - `delivery/App.tsx` (Board switcher, History, Actions)
  - `mon-cv/App.tsx` (Export)
- **Pattern** : bouton avec chevron + menu absolu avec item links + click-outside.
- **Promotion** : `packages/shared/src/components/HeaderMenu/HeaderMenu.tsx` (le menu `<details>` HTML5 pourrait remplacer la version JS).

### Pattern "Empty state card" (delivery, roadmap, mon-cv, suivitess)
- **Fichiers** : dupliqué dans `BoardList`, `PlanningList`, `CVListPage`, `DocumentSelector`.
- **Pattern** : card centrée avec icône + titre + hint + bouton "Créer".
- **Promotion** : `packages/shared/src/components/EmptyState/EmptyState.tsx` (props `icon`, `title`, `hint`, `cta`).

### Pattern "Inline pill dropdown" (suivitess decision card)
- **Fichier** : `BulkTranscriptionImportModal.tsx` classes `.aiDecisionInlineDropdown`.
- **Pattern** : pill coloré (vert/ambre/accent) qui s'ouvre en dropdown inline dans une phrase + chevron discret + edit icon ✎ quand "new".
- **Promotion** : `packages/shared/src/components/InlinePill/InlinePill.tsx`.

### Pattern "segmented control" (BoardList, delivery import Par sprint/URL, conges ViewControls, rag ChatView)
- **Fichiers** : JiraImportModal, ViewControls, etc. (chacun avec son CSS).
- **Pattern** : 2+ boutons collés en "onglets compacts" pour choisir un mode.
- **Promotion** : `packages/shared/src/components/SegmentedControl/SegmentedControl.tsx`.

---

# 3. 🔒 Locaux légitimes

Trop spécifiques au domaine ou trop couplés à leur module pour être partagés.

## Suivitess

- `DocumentSelector`, `ReviewWizard`, `TableOfContents`, `SubjectReview`,
  `BulkTranscriptionImportModal`, `SkillButton`, `SubjectAnalysisModal`,
  `TicketCreateModal`, `EmailPreviewModal`, `RecorderBar`,
  `HistoryPanel`, `Preview`, `SuggestionsPanel`.

## Roadmap

- `GanttBoard` et ses sous-composants (`TaskBar`, `DependencyLines`,
  `MarkerLine`, `TodayMarker`), `TaskForm`, `SubjectsPanel`,
  `PlanningList`, `PlanningForm`, `ViewSelector`.

## Delivery

- `BoardDelivery`, `BoardList`, `BoardRow`, `SprintColumn`, `TaskBlock`,
  `ReleaseMarker`, `TodayMarker`, `JiraImportModal`, `ImportModal`,
  `LayoutRulesModal`, `SanityCheckModal`, `SnapshotModal`, `RestoreModal`.

## Mon CV

- `CVListPage`, `MyProfilePage`, `AdaptationsListPage`, `AdaptCVPage`,
  `AdaptationDetailPage`, `ImportCVModal`, `ExportSection`, `EmbedView`.

## Congés

- `LeaveCalendar`, `LeaveBar`, `LeaveForm`, `Legend`, `MemberList`,
  `ViewControls`.

## RAG

- `RagList`, `RagDetail`, `RagForm`, `ChatView`, `ConversationList`,
  `IndexModal`, `SourcesPanel`, `EmbedChat`, `EmbedChatPage`.

## Gateway (core)

- `ConnectorsPage`, `Dashboard`, `ModuleRecentBlock`,
  `QuickActionsSection`, `AdminPage`, `AdminAiSkillsSection`,
  `AdminLegacyBulletsSection`, `SettingsPage`, `LandingPage`,
  `LoginPage`, `RegisterPage`.

## Admin pages autonomes

- `/ai-logs` — `ai-logs/App.tsx`
- `/ai-evals` — `ai-evals/App.tsx`
- `/ai-playground` — `ai-playground/App.tsx`
- `/prompt-logs` — `prompt-logs/App.tsx`
- `/admin-features` — `admin-features/App.tsx`
- `/design-system` — `design-system/App.tsx` (showcase interne)

---

# 4. Plan de convergence

Priorité du refactor (impact × effort) :

| Action                                                 | Impact          | Effort      |
| ------------------------------------------------------ | --------------- | ----------- |
| Promouvoir `Dropdown` générique (réutilisé partout)    | ⭐⭐⭐             | 🔧🔧         |
| Promouvoir `EmptyState`                                | ⭐⭐              | 🔧          |
| Promouvoir `SegmentedControl`                          | ⭐⭐              | 🔧          |
| Promouvoir `CodeBlock`                                 | ⭐⭐              | 🔧          |
| Promouvoir `StepsProgress`                             | ⭐               | 🔧🔧         |
| Promouvoir `HeaderMenu` (ou migrer vers `<details>`)   | ⭐               | 🔧          |
| Regrouper `ListEditor`/`TagEditor`/`ImageUploader`/`ProjectEditor` sous `packages/shared/CVEditors/` ou les rapatrier dans mon-cv | ⭐ | 🔧 |
| Fusionner `CreditBadge` dans `Badge` (mode counter)    | faible          | 🔧          |

## Conventions à maintenir

- **Tout composant utilisé par ≥ 2 modules distincts doit vivre dans
  `packages/shared/`.**
- `packages/shared/src/components/<Nom>/<Nom>.tsx` + `<Nom>.module.css` à
  côté.
- Les composants spécifiques à un module restent dans
  `apps/platform/src/modules/<module>/components/<Nom>/`.
- Tests : `__tests__/*.test.ts` à côté.
- Avant de créer un nouveau composant, **vérifier §1** — si un pattern
  shared existe, l'utiliser ou l'étendre plutôt que de réinventer.
