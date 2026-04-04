---
name: figma-to-code
description: Convertit un design Figma en code React utilisant les composants du boilerplate shared design system
triggers:
  - figma
  - figma make
  - figma.com
  - importer depuis figma
  - design to code
---

# /figma-to-code

Convertit automatiquement un design Figma en code React dans le boilerplate, en utilisant UNIQUEMENT les composants du shared design system.

**Input** : URL Figma (figma.com/design/... ou figma.com/make/...)

---

## Workflow automatique

### 1. Extraire le design depuis Figma

A partir de l'URL fournie, extraire le fileKey et nodeId :
- `figma.com/design/:fileKey/:fileName?node-id=:nodeId` → nodeId avec ":" au lieu de "-"
- `figma.com/make/:makeFileKey/:makeFileName` → utiliser makeFileKey

Appeler `get_design_context` avec le fileKey et nodeId pour obtenir :
- Le code de reference (React + Tailwind)
- Un screenshot du design
- Les metadata des composants

### 2. Mapper les composants Figma → Shared

Utiliser le mapping suivant pour convertir les composants Figma en imports `@boilerplate/shared/components` :

| Element Figma | Composant Shared | Import |
|--------------|-----------------|--------|
| Bouton primary/secondary/danger | `Button` | `@boilerplate/shared/components` |
| Badge/tag avec couleur | `Badge` | `@boilerplate/shared/components` |
| Carte avec bordure | `Card` | `@boilerplate/shared/components` |
| Header avec retour + titre | `ModuleHeader` | `@boilerplate/shared/components` |
| Champ de formulaire avec label | `FormField` | `@boilerplate/shared/components` |
| Modale/dialog | `Modal` | `@boilerplate/shared/components` |
| Modale de confirmation | `ConfirmModal` | `@boilerplate/shared/components` |
| Toast/notification | `ToastContainer` | `@boilerplate/shared/components` |
| Spinner/loading | `LoadingSpinner` | `@boilerplate/shared/components` |
| Section repliable | `ExpandableSection` | `@boilerplate/shared/components` |
| Toggle radio-like | `ToggleGroup` | `@boilerplate/shared/components` |
| Onglets | `Tabs` | `@boilerplate/shared/components` |
| Titre de section uppercase | `SectionTitle` | `@boilerplate/shared/components` |
| Menu deroulant | `MenuDropdown` | `@boilerplate/shared/components` |
| Texte editable | `InlineEdit` | `@boilerplate/shared/components` |
| Zone drag & drop | `FileDragDropZone` | `@boilerplate/shared/components` |
| Liste editable | `ListEditor` | `@boilerplate/shared/components` |
| Tags editable | `TagEditor` | `@boilerplate/shared/components` |
| Upload image | `ImageUploader` | `@boilerplate/shared/components` |
| Layout page | `Layout` | `@boilerplate/shared/components` |

### Classes CSS Card (pour les listes) :
| Element Figma | Classe CSS |
|--------------|-----------|
| Icone dans une carte | `shared-card__icon` |
| Titre + sous-titre dans une carte | `shared-card__content` + `shared-card__title` + `shared-card__subtitle` |
| Bouton edit au hover | `shared-card__edit-btn` |
| Bouton delete au hover | `shared-card__delete-btn` |
| Fleche chevron | `shared-card__arrow` |

### 2b. Detecter et creer les nouveaux composants — ETAPE BLOQUANTE

**OBLIGATOIRE : Pour CHAQUE element du design qui ne correspond pas a un composant shared existant, TOUJOURS demander a l'utilisateur.**

Utiliser AskUserQuestion pour CHAQUE element non reconnu :

```
Element detecte : [nom de l'element, ex: "Hero Section", "Footer", "Stats Counter"]

Ce composant n'existe pas dans le shared. Options :
1. Promouvoir — Creer un composant reutilisable dans @boilerplate/shared
2. Page-specific — Garder en CSS custom uniquement pour cette page
3. Ignorer — Ne pas inclure cet element
```

**NE JAMAIS decider seul** de mettre un element en "page-specific" sans demander.

#### Si l'utilisateur choisit "Promouvoir" :

1. **Identifier** le composant (nom, props, variants)
2. **Creer le composant** dans `packages/shared/src/components/<NouveauComposant>/`
   - `<NouveauComposant>.tsx` — composant React
   - `<NouveauComposant>.css` — styles avec tokens CSS uniquement
3. **Exporter** depuis `packages/shared/src/components/index.ts`
4. **Ajouter a la page Design System** (`apps/platform/src/modules/design-system/App.tsx`)
5. **OBLIGATOIRE — Exporter dans Figma Design** :
   - Charger le skill `figma:figma-use` (prerequis obligatoire)
   - Appeler `use_figma` avec `fileKey: "disZwchND38mOZEYwoHqRR"` pour creer le composant dans la page Composants (node `0:1`)
   - Le composant Figma DOIT :
     - Avoir le meme nom que le composant React
     - Etre un Component ou ComponentSet avec les variants si applicable
     - Utiliser les couleurs/spacing/radius du design system Figma existant
     - Etre positionne a cote des autres composants existants sur la page
   - NE JAMAIS sauter cette etape — chaque composant shared DOIT exister dans Figma
6. **Mettre a jour le mapping** dans ce skill (tableau Figma → Shared ci-dessus) avec le nouveau nodeId retourne par use_figma
7. **Mettre a jour le skill page-composer** (`.claude/skills/page-composer/skill.md`) pour ajouter le nouveau composant dans le catalogue et le mapping Figma

REGLES pour les nouveaux composants :
- Utiliser UNIQUEMENT les tokens CSS du boilerplate (`var(--token)`)
- Nommer les classes CSS avec le prefixe `shared-` (ex: `shared-newcomp`)
- Props en TypeScript avec interface exportee
- Le composant doit etre generique et reutilisable (pas specifique a un module)

### 3. Convertir le code

REGLES de conversion :
- **JAMAIS de Tailwind** → utiliser les tokens CSS du boilerplate (`var(--spacing-md)`, `var(--accent-primary)`, etc.)
- **JAMAIS de valeurs en dur** → toujours `var(--token)`
- **JAMAIS de nouveau composant** si un composant shared existe
- **Prefixer les classes CSS** avec le nom du module (ex: `delivery-xxx`)
- **Interface utilisateur en francais**, code en anglais
- **Imports depuis** `@boilerplate/shared/components` uniquement

### 4. Ecrire les fichiers — ETAPE BLOQUANTE

**OBLIGATOIRE : Toujours demander a l'utilisateur ou placer le code AVANT d'ecrire quoi que ce soit.**

Utiliser AskUserQuestion avec les options :
- **Remplacer une page existante** — lister les pages candidates du module concerne. Si l'utilisateur choisit cette option, demander QUELLE page remplacer et QUEL module.
- **Creer une nouvelle page** dans un module existant — demander dans quel module et a quelle URL
- **Page de demo** pour tester — ecrire dans le module demo existant
- **Nouveau module** — creer un nouveau module complet (utiliser le skill `/module-creator`)

**NE JAMAIS ecrire de fichier sans avoir la reponse de l'utilisateur.**

Ecrire :
- Le composant React (`.tsx`)
- Le fichier CSS (`.css` ou `.module.css`)
- Mettre a jour les imports si necessaire (`App.tsx`, `router.tsx`)

### 4b. Sync bidirectionnelle Code ↔ Figma

Apres avoir ecrit le code, si de nouveaux composants ont ete crees (etape 2b) :
1. Charger le skill `figma:figma-use`
2. Appeler `use_figma` pour creer chaque nouveau composant dans Figma :
   - Page Composants (`0:1`) du fichier `disZwchND38mOZEYwoHqRR`
   - Creer un ComponentSet avec les variants
   - Utiliser les couleurs/spacing/radius du design system Figma
   - Positionner a cote des composants existants

Exemple de code `use_figma` pour creer un composant :
```javascript
const page = figma.root.children.find(p => p.name === 'Composants');
if (page) {
  await figma.setCurrentPageAsync(page);
  const frame = figma.createFrame();
  frame.name = 'NouveauComposant';
  frame.resize(320, 60);
  // ... configurer le composant avec les design tokens
  const component = figma.createComponentFromNode(frame);
}
```

### 5. Preview

Afficher le rendu via Preview MCP ou Chrome MCP :
- `preview_start("dev-platform")` si pas deja lance
- Naviguer vers la page du module
- `preview_screenshot` pour montrer le resultat
- Comparer avec le screenshot Figma original

### 5b. Exporter la page complete dans Figma Design — OBLIGATOIRE

Apres avoir ecrit le code et verifie le preview, TOUJOURS creer la page complete dans le fichier Figma Design (`disZwchND38mOZEYwoHqRR`).

**REGLES CRITIQUES pour la reproduction fidele :**

1. Charger le skill `figma:figma-use`
2. Creer une nouvelle page dans le fichier Figma (ou utiliser une page existante si c'est un remplacement)
3. **Reproduire EXACTEMENT le contenu du Figma Make source** :
   - **Textes** : utiliser les VRAIS textes du design source (titres, descriptions, labels) — JAMAIS de texte generique ou placeholder
   - **Images** : telecharger et inclure les images du design source (via les URLs des assets Figma Make) — utiliser `figma.createImageAsync()` ou `figma.createRectangle()` avec image fill
   - **Layout** : reproduire fidèlement les espacements, alignements, grilles du design source
   - **Couleurs** : utiliser les design tokens Figma existants, pas des couleurs approximatives
4. Composer la page en utilisant les **instances des composants** existants dans la page Composants
5. Pour chaque instance, **overrider les textes** avec le contenu reel du design source
6. La page Figma doit etre une **reproduction 1:1** du design source — pas une version simplifiee

**CE QUI EST INTERDIT :**
- ❌ Texte generique ("Description de la fonctionnalite", "Lien 1", "Lien 2")
- ❌ Images manquantes ou placeholder gris
- ❌ Layout approximatif qui ne correspond pas au design source
- ❌ Contenu invente qui n'est pas dans le design source

### 5c. Publier la bibliotheque Figma — ETAPE MANUELLE

Apres avoir cree les composants dans Figma Design, rappeler a l'utilisateur de **publier la bibliotheque** manuellement :

1. Dans Figma, aller dans le fichier Design (`disZwchND38mOZEYwoHqRR`)
2. Menu Assets → "Publier une bibliothèque" (ou Ctrl+Alt+O)
3. Selectionner les nouveaux composants ajoutes
4. Cliquer "Publier"
5. Ensuite "Exporter vers Figma Make" pour rendre les composants disponibles dans Make

⚠️ Cette etape ne peut PAS etre automatisee via l'API Plugin Figma. C'est une limite de Figma.

### 6. Iterer

Montrer le screenshot du rendu a cote du screenshot Figma.
Si des differences sont visibles, corriger et re-screenshot.
Attendre la validation de l'utilisateur avant de continuer.

---

## Tokens CSS — Reference

### Couleurs
`--bg-primary`, `--bg-card`, `--bg-hover`, `--text-primary`, `--text-secondary`, `--text-muted`
`--accent-primary`, `--success`, `--warning`, `--error`, `--info`, `--border-color`

### Spacing
`--spacing-2xs` (2px) → `--spacing-3xl` (48px)

### Typographie
`--font-size-xs` (11px) → `--font-size-3xl` (24px), `--font-family-mono`

### Divers
`--radius-sm/md/lg`, `--shadow-xs/focus`, `--transition-fast/normal`

---

## Figma Design System Reference

**File Key** : `disZwchND38mOZEYwoHqRR`
**Page Composants** : node `0:1`

| Composant | Node ID |
|-----------|---------|
| Card | `8:11` |
| ToggleGroup | `9:2` |
| FormField | `10:19` |
| ExpandableSection | `13:19` |
| LoadingSpinner | `15:12` |
| ModuleHeader | `18:2` |
| TagEditor | `19:2` |
| ImageUploader | `21:10` |
| SharedNav | `22:2` |
| Button | `25:10` |
| Badge | `26:12` |
| Toast | `33:22` |
| ListEditor | `38:2` |
| Modal | `39:2` |
| ConfirmModal | `41:28` |
| GanttBoard | `27:2` |
| BoardDelivery | `29:2` |
| TaskContainer | `115:30` |

---

## Pattern de page standard

```tsx
import { useState } from 'react';
import {
  Layout, ModuleHeader, Card, Button, Modal, FormField,
  ConfirmModal, ToastContainer, LoadingSpinner, Badge,
} from '@boilerplate/shared/components';
import type { ToastData } from '@boilerplate/shared/components';

export default function ModuleApp({ onNavigate }: { onNavigate?: (path: string) => void }) {
  return (
    <Layout appId="module-name" variant="full-width" onNavigate={onNavigate}>
      <ModuleHeader title="Titre" onBack={() => onNavigate?.('/')}>
        <Button variant="primary">+ Action</Button>
      </ModuleHeader>
      {/* Contenu */}
    </Layout>
  );
}
```

## Pattern liste standard

```tsx
<div className="module-list">
  {items.map(item => (
    <Card key={item.id} variant="interactive" onClick={() => onSelect(item)} className="module-doc-card">
      <div className="shared-card__icon">
        <svg>...</svg>
      </div>
      <div className="shared-card__content">
        <span className="shared-card__title">{item.name}</span>
      </div>
      <button className="shared-card__edit-btn" onClick={e => { e.stopPropagation(); onEdit(item); }} title="Modifier">
        <svg>...</svg>
      </button>
      <button className="shared-card__delete-btn" onClick={e => { e.stopPropagation(); onDelete(item); }} title="Supprimer">
        <svg>...</svg>
      </button>
      <div className="shared-card__arrow">
        <svg>...</svg>
      </div>
    </Card>
  ))}
</div>
```
