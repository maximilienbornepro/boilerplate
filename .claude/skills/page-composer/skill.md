---
name: page-composer
description: Compose and modify module pages visually using the boilerplate design system, with visual validation before each element
---

# /page-composer

Compose ou modifie les pages des modules du boilerplate. Chaque element est valide visuellement par l'utilisateur AVANT d'etre code, via une triple verification : code, screenshot, et Figma.

**Input** : Nom du module cible (optionnel) + description de ce qu'on veut faire.

---

## Figma Design System

**URL** : https://www.figma.com/design/disZwchND38mOZEYwoHqRR/Vitesse
**File Key** : `disZwchND38mOZEYwoHqRR`
**Page** : Composants (node `0:1`)

### Mapping composants Figma ↔ Code

| Composant | Figma Node | Variants Figma | Import code |
|-----------|-----------|----------------|-------------|
| Card | `8:11` | default, compact, interactive | `@boilerplate/shared/components` |
| ToggleGroup | `9:2` | — | `@boilerplate/shared/components` |
| FormField | `10:19` | default, error, required | `@boilerplate/shared/components` |
| ExpandableSection | `13:19` | expanded, collapsed | `@boilerplate/shared/components` |
| LoadingSpinner | `15:12` | sm, md, lg | `@boilerplate/shared/components` |
| ModuleHeader | `18:2` | — | `@boilerplate/shared/components` |
| TagEditor | `19:2` | — | `@boilerplate/shared/components` |
| ImageUploader | `21:10` | small, medium, large | `@boilerplate/shared/components` |
| SharedNav | `22:2` | — | `@boilerplate/shared/components` |
| Button | `25:10` | primary, secondary, danger, disabled | Classes CSS `module-header-btn-*` |
| Badge | `26:12` | success, warning, error, info, accent | Pas de composant code — custom CSS |
| Toast | `33:22` | success, error, info, warning | `@boilerplate/shared/components` |
| ListEditor | `38:2` | — | `@boilerplate/shared/components` |
| Modal | `39:2` | — | `@boilerplate/shared/components` |
| ConfirmModal | `41:28` | default, danger | `@boilerplate/shared/components` |
| GanttBoard | `27:2` | — | Module roadmap |
| BoardDelivery | `29:2` | — | Module delivery |
| TaskContainer | `115:30` | with-children, empty | Module delivery |

---

## Regle fondamentale : TRIPLE VALIDATION AVANT CODE

**JAMAIS de code sans validation visuelle prealable.**

Pour chaque element de la page, AVANT d'ecrire le moindre code, effectuer 3 verifications :

### 1. Reference code
- Le composant existe-t-il dans `@boilerplate/shared/components` ?
- Si oui : nommer le composant, ses props et variants

### 2. Screenshot visuel
- Naviguer vers `/design-system` ou un module existant qui utilise ce composant
- Prendre un screenshot (Chrome MCP) ou un zoom sur l'element
- Montrer le screenshot a l'utilisateur

### 3. Reference Figma
- Verifier si le composant existe dans le fichier Figma (voir mapping ci-dessus)
- Si oui : `get_screenshot(nodeId, fileKey="disZwchND38mOZEYwoHqRR")` pour montrer le visuel Figma
- Presenter le screenshot Figma a cote du screenshot code

### Presenter les 3 a l'utilisateur

```
Element : [nom de l'element]

1. CODE : Composant `Card` variant="interactive" de @boilerplate/shared
2. SCREENSHOT : [screenshot du composant dans l'app]
3. FIGMA : [screenshot du composant dans Figma node 8:11]

Ca te convient ? Ou tu preferes une alternative ?
```

### Si l'element N'EXISTE PAS

1. Lister les composants les plus proches (code + Figma)
2. Montrer les screenshots de chaque alternative
3. Proposer les options :
   - **Reutiliser** un composant existant
   - **Promouvoir** : creer dans le shared + ajouter dans Figma
   - **Page-specific** : custom pour cette page uniquement
4. Attendre le choix

### Si refus

Montrer toutes les alternatives existantes avec :
- Screenshot code de chaque alternative
- Screenshot Figma de chaque alternative
- L'utilisateur choisit visuellement

---

## Workflow

### 1. Demarrer le Preview

S'assurer que le dev server tourne. Utiliser Chrome MCP pour naviguer et capturer des screenshots.

### 2. Analyser le module cible

- Lire les fichiers du module
- Screenshot de la page actuelle
- Presenter la structure a l'utilisateur

### 3. Decomposer la demande

Quand l'utilisateur decrit une page, la decomposer en elements :

```
Demande : "une page liste avec un bouton creer"

Elements :
1. Layout wrapper → Layout (shared) — Figma: SharedNav 22:2
2. Header avec titre → ModuleHeader (shared) — Figma: 18:2
3. Bouton "Creer" → Button primary — Figma: 25:2
4. Liste d'items → Card interactive (shared) — Figma: 8:8
5. Contenu carte → existe ? ou custom ?
6. Bouton supprimer → Button danger — Figma: 25:6
7. Modale creation → Modal (shared) — Figma: 39:2
8. Champs formulaire → FormField (shared) — Figma: 10:2
9. Toast feedback → Toast (shared) — Figma: 33:2
```

Presenter cette decomposition a l'utilisateur, puis valider element par element.

### 4. Boucle de validation element par element

Pour CHAQUE element :

1. Chercher dans le mapping Figma
2. `get_screenshot(nodeId, fileKey="disZwchND38mOZEYwoHqRR")` pour le visuel Figma
3. Screenshot du composant dans l'app (Chrome MCP navigate + screenshot/zoom)
4. Presenter les 2 visuels + reference code
5. Attendre validation
6. Si valide : ecrire le code
7. Screenshot du resultat
8. Passer a l'element suivant

### 5. Finaliser

- Resumer les fichiers modifies
- Lister composants shared vs custom
- Ne PAS commit — attendre l'instruction explicite

---

## Regles

- **Utiliser UNIQUEMENT** les composants de `@boilerplate/shared/components` et les tokens CSS de `theme.css`
- **Jamais** de valeurs CSS en dur — toujours `var(--token)`
- **Jamais** de nouvelles dependances npm
- **Jamais** de code avant triple validation (code + screenshot + Figma)
- Prefixer les classes CSS globales avec le nom du module
- Interface utilisateur en **francais**, code en **anglais**

---

## Catalogue des composants

### Layout & Navigation

#### `Layout`
Container principal. **Obligatoire**.
```tsx
<Layout appId="module" variant="full-width" onNavigate={onNavigate}>
```
Variants : `centered`, `centered-narrow`, `full-width`, `sidebar`, `custom`

#### `ModuleHeader` — Figma `18:2`
Header de page. **Obligatoire**.
```tsx
<ModuleHeader title="Titre" subtitle="Sous-titre" onBack={() => onNavigate?.('/')}>
  <button className="module-header-btn module-header-btn-primary">Action</button>
</ModuleHeader>
```
Boutons : `module-header-btn`, `-primary` (cyan), `-success` (vert), `-danger` (rouge)

### Contenu

| Composant | Figma | Variants |
|-----------|-------|----------|
| `Card` | `8:11` | default, compact, interactive + selected |
| `ActionCard` | — | titre + description + action |
| `ScoreBlock` | — | metriques avant/apres |
| `ExpandableSection` | `13:19` | expanded, collapsed + badge |

### Formulaires

| Composant | Figma | Usage |
|-----------|-------|-------|
| `FormField` | `10:19` | Wrapper input + label + erreur |
| `ToggleGroup` | `9:2` | Boutons toggle radio-like |
| `InlineEdit` | — | Texte editable au clic |
| `ListEditor` | `38:2` | Liste dynamique |
| `TagEditor` | `19:2` | Tags saisie libre |
| `ImageUploader` | `21:10` | Upload image + preview |

### Overlay & Feedback

| Composant | Figma | Usage |
|-----------|-------|-------|
| `Modal` | `39:2` | Modale libre |
| `ConfirmModal` | `41:28` | Confirmation (default, danger) |
| `Toast` | `33:22` | Notifications (4 types) |
| `LoadingSpinner` | `15:12` | Chargement (sm, md, lg) |
| `MenuDropdown` | — | Menu deroulant |

### Composants Figma sans equivalent code

| Composant Figma | Node | Action requise |
|----------------|------|----------------|
| `Button` | `25:10` | Utiliser classes `module-header-btn-*` ou creer composant |
| `Badge` | `26:12` | Pas de composant — CSS custom ou creer composant |

---

## Tokens CSS — Reference rapide

### Couleurs
`--bg-primary`, `--bg-card`, `--bg-hover`, `--text-primary`, `--text-secondary`, `--text-muted`
`--accent-primary`, `--success`, `--warning`, `--error`, `--info`, `--border-color`

### Spacing
`--spacing-2xs` (2px) → `--spacing-3xl` (48px)

### Typographie
`--font-size-xs` (11px) → `--font-size-3xl` (24px), `--font-family-mono`

### Divers
`--radius-sm/md/lg`, `--shadow-xs/focus`, `--transition-fast/normal`
