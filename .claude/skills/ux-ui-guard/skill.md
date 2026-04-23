---
name: ux-ui-guard
description: Force la reutilisation des composants existants avant toute modification UI/UX et maintient le design system synchronise via l'audit automatique.
autoSuggest: true
triggers:
  - composant
  - modal
  - dropdown
  - bouton
  - formulaire
  - page
  - ecran
  - layout
  - style
  - css
  - theme
  - couleur
  - typo
  - typographie
  - design
  - design system
  - ux
  - ui
  - interface
  - module
  - landing
  - ajustement
  - mise a jour
  - correction
  - creation
  - html
  - jsx
  - render
  - affichage
  - balise
  - react
---

# UX/UI Guard

Skill qui intercepte **toute demande impactant l'UX/UI** (creation, correction, mise a jour d'un module, d'une page, d'un composant, d'un style) et **contraint** Claude a :

1. Consulter la carte d'usage reelle des composants avant de coder.
2. Reutiliser un composant existant plutot que d'en reinventer un.
3. Maintenir le design system synchronise avec la realite du code.

Perimetre de verite : `design-system.data.json` a la racine, genere par
`npm run audit:components`. Scope audite : **Landing + Roadmap + Conges +
Delivery + SuiviTess**.

---

## DECLENCHEMENT — AUTOMATIQUE

Ce skill se declenche des que la demande utilisateur contient un mot-cle
UX/UI (voir `triggers` ci-dessus) ou concerne :

- la **creation** d'un nouvel element visuel (composant, page, modale...)
- la **correction** d'un bug d'affichage / style / interaction
- la **mise a jour** d'un composant existant (ajout/suppression de variante,
  changement de token, nouveau prop)
- toute **refonte** de page ou de module

Si une demande est ambigue, se comporter comme si le skill etait actif
(cout marginal faible, benefice grand en coherence).

---

## WORKFLOW OBLIGATOIRE

### 1. AVANT d'ecrire du code

```bash
# Toujours charger la source de verite
cat design-system.data.json
```

Puis :

1. **Identifier la cible** : quel module, quelle page, quel composant.
2. **Chercher un match dans `shared.used`** :
   - `Button`, `FormField`, `Modal`, `ConfirmModal`, `LoadingSpinner`,
     `Card`, `ModuleHeader`, `Layout`, `ToastContainer`, `VisibilityPicker`,
     `SharingModal`, `ExpandableSection`, `Tabs`...
   - Si un match existe → **utiliser ce composant partage, sans exception**.
3. **Si pas de match, chercher dans `localByModule`** :
   - Peut-etre qu'un module voisin a deja ce pattern.
   - Considerer l'extraction vers `packages/shared/` si le pattern apparait
     dans ≥ 2 modules (voir `duplicates`).
4. **Si aucun match nulle part** : proposer a l'utilisateur AVANT de coder :
   > « Je ne trouve pas de composant equivalent. Je propose de creer
   > `<NomDuComposant>` local au module `<module>`. Souhaites-tu plutot
   > le creer directement dans `packages/shared/` (reutilisable) ? »

### 2. PENDANT le code

Regles dures, non negociables :

- **INTERDIT** : recreer localement un composant qui existe deja dans
  `packages/shared/` (Modal, Dropdown, Spinner, Button, Card, FormField...).
- **INTERDIT** : utiliser des hex codes pour des couleurs qui existent en
  token (`#10b981` est interdit si `var(--accent-primary)` cascade depuis
  `Layout appId`).
- **INTERDIT** : creer un nouveau fichier dans `packages/shared/` sans
  mettre a jour le design-system (auto par l'audit).
- **OBLIGATOIRE** : les couleurs de module viennent de `APPS` (`@boilerplate/shared/components`),
  les statuts de `STATUS_OPTIONS` (SuiviTess types).
- **OBLIGATOIRE** : chaque nouveau composant partage doit exposer son
  `tsx` + `.module.css` + typage exporte.
- **OBLIGATOIRE — validation d'alignement** : pour CHAQUE composant que tu
  edites, confirmer qu'il correspond a celui declare dans le DS :
  1. Son nom apparait-il dans `design-system.data.json > shared.used` ?
     → Alors c'est un composant partage, utiliser tel quel.
  2. Son nom apparait-il dans `localByModule` pour un autre module ?
     → Considerer la promotion vers shared (cf. `duplicates`).
  3. Si tu ajoutes un tag `<Button>`, `<Modal>`, `<Card>`...
     sans import depuis `@boilerplate/shared/components`, c'est un drift
     → remplacer par l'import shared (le hook le detecte et bloque).

### 2.5. PREVIEW SANDBOX — OBLIGATOIRE

Toute modification UI DOIT etre visualisee dans la sandbox AVANT d'etre
appliquee au fichier cible. Le flow devient :

1. Ecrire le snippet dans `apps/platform/src/ux-preview/currentPreview.tsx`
   en respectant la contrainte :
   - export default d'un composant React
   - imports shared + types autorises
   - self-contained (pas de fetch, pas de router, mocks inline si besoin)

2. Indiquer a l'utilisateur l'URL a ouvrir :
   `/ux-preview?appId=<module-cible>`

3. Attendre la confirmation visuelle explicite (« oui »).

4. Une fois la preview validee, `touch .claude/.ux-ui-ack` puis ecrire
   dans le fichier cible reel.

5. APRES l'ecriture reelle, reinitialiser la sandbox :
   reecrire `currentPreview.tsx` avec le placeholder par defaut
   (voir l'en-tete du fichier source).

### 3. APRES le code

```bash
# Regenerer la carte d'usage
npm run audit:components
```

Puis verifier :

1. `design-system.data.json` a-t-il change ?
   - **Oui** → commiter le JSON avec le changement de code (meme commit).
2. L'audit remonte-t-il un duplicate ou un nouvel `unused` ?
   - **Oui** → soit corriger (deduper ou ajouter l'usage), soit prevenir
     l'utilisateur pour arbitrage.
3. Les tests `npm test` passent-ils ?

### 4. VERIFICATION VISUELLE

Si la modification est observable dans le navigateur :

1. Lancer le serveur preview si besoin.
2. Naviguer vers la page impactee.
3. Prendre un screenshot ou utiliser `preview_snapshot` pour verifier
   l'UI rendue.
4. Confirmer l'alignement avec le design system (tokens, composants).

---

## EXEMPLES

### Exemple 1 — demande ambigue

> « Ajoute une modal de confirmation pour supprimer un planning. »

**Workflow** :
1. Cat `design-system.data.json` → `ConfirmModal` est dans `shared.used`
   (utilise par `delivery`, `suivitess`...).
2. Repondre : « J'utilise `ConfirmModal` du shared (deja utilise par 3
   autres modules). Pas de nouveau composant a creer. »
3. Coder avec `<ConfirmModal title="..." message="..." onConfirm={} onCancel={} />`.

### Exemple 2 — creation d'un nouveau pattern

> « Ajoute un selecteur de periode sur la page Conges. »

**Workflow** :
1. Cat `design-system.data.json` → pas de `DatePicker` ni
   `PeriodSelector` dans `shared.used`.
2. Verifier `localByModule.conges` → `ViewControls` fait deja ca !
3. Repondre : « Le composant `ViewControls` existe deja dans `conges`.
   Je l'etends plutot que de creer un nouveau composant. »
4. Coder en modifiant `ViewControls`.

### Exemple 3 — pattern duplique detecte

> « Ajoute une modale d'import Jira sur `delivery`. »

**Workflow** :
1. Cat `design-system.data.json` → `duplicates` contient peut-etre
   `Dropdown` avec plusieurs impls.
2. Si deja plusieurs `ImportModal` locales → FLAG : « J'observe que
   `suivitess` et `delivery` ont chacun leur `ImportModal`. Avant
   d'ajouter le 3e, on devrait extraire dans shared. Veux-tu continuer
   quand meme ou refactorer d'abord ? »

### Exemple 4 — mise a jour d'un composant shared

> « Le Button shared doit avoir une variante `ghost`. »

**Workflow** :
1. Modifier `packages/shared/src/components/Button/Button.tsx` :
   - Ajouter `'ghost'` au type `ButtonVariant`.
   - Ajouter le style correspondant dans `Button.css`.
2. Mettre a jour le design system — la demo `Button` dans
   `design-system/App.tsx` doit montrer la nouvelle variante.
3. Re-executer `npm run audit:components` pour verifier que le count
   remonte.
4. Commit avec le JSON regenere.

---

## OUTILS A PORTEE

| Action | Commande |
|--------|----------|
| Regenerer la carte d'usage | `npm run audit:components` |
| Voir la page design system | Navigation vers `/design-system` |
| Composants shared disponibles | `packages/shared/src/components/index.ts` |
| Tokens CSS | `packages/shared/src/styles/theme.css` |
| Couleurs de module | `APPS` dans `packages/shared/src/components/SharedNav/constants.ts` |
| Couleurs de statut SuiviTess | `STATUS_OPTIONS` dans `apps/platform/src/modules/suivitess/types/index.ts` |

---

## CE QU'IL NE FAUT JAMAIS FAIRE

- Creer un fichier `*/components/MyDropdown.tsx` si `Dropdown` ou equivalent
  existe deja dans shared.
- Hardcoder un hex code qu'on pourrait remplacer par une CSS var.
- Modifier un composant partage sans mettre a jour sa demo dans le
  design system.
- Ignorer la sortie d'un audit qui remonte un duplicate — toujours
  l'adresser (refactor ou autorisation explicite de l'utilisateur).
- Modifier la structure du design system sans re-executer l'audit
  d'abord (sinon `design-system.data.json` est stale).

---

## INVOCATION MANUELLE

Si le skill ne s'est pas auto-declenche et que le user travaille sur
quelque chose qui touche a l'UX/UI, Claude peut l'invoquer en disant :

> « Comme ta demande touche a l'UX, j'applique le skill `ux-ui-guard`. »

Puis derouler le workflow ci-dessus.

---

## HOOK BLOQUANT — `ux-ui-enforcer.sh`

Un hook `PreToolUse` intercepte CHAQUE `Write`/`Edit` sur les fichiers
`.tsx` / `.jsx` / `.css` / `.html` situes dans l'un des 5 modules en
scope (landing, conges, roadmap, delivery, suivitess) ou dans
`packages/shared/src/components/`.

### Flow impose

1. Premier essai d'ecrire un fichier UI → **hook bloque** (exit 2).
2. Stderr affiche la checklist que Claude doit presenter a l'utilisateur.
3. Claude ecrit son message :

   ```
   ┌──────────────────────────────────────────┐
   │ UX-UI GUARD — Checklist avant ecriture   │
   └──────────────────────────────────────────┘
   • Fichier        : <chemin>
   • Intent         : <1-2 phrases expliquant le changement>
   • Composants     : <liste des composants @boilerplate/shared utilises>
   • Composants locaux existants reutilises : <liste>
   • Design tokens  : <liste des var(--...) referencees>
   • Nouveau pattern ? : oui / non (si oui, justifier)

   Tu confirmes ? (reponds « oui » pour debloquer)
   ```

4. L'utilisateur confirme (« oui », « ok », « go »).
5. Claude debloque en executant :

   ```bash
   touch .claude/.ux-ui-ack
   ```

6. Claude relance son Write/Edit → cette fois le hook accepte.
7. L'ack reste valide 5 min (couvre une rafale d'edits coherents), puis
   la discipline reapplique.

### Quand la checklist est-elle necessaire ?

- **Toujours** pour une premiere edition UI dans une session.
- **Toujours** apres une pause > 5 min (ack expire).
- **Toujours** au changement de fichier/page/module.
- **Toujours** quand on touche `packages/shared/` (zone critique).

### Comment presenter la checklist au user ?

Format strict attendu (le user doit voir les composants/tokens AVANT
de confirmer) :

```markdown
**Je vais toucher** : `apps/platform/src/modules/suivitess/App.tsx`

**Objectif** : ajouter une modale de confirmation pour la suppression
d'un document.

**Composants @boilerplate/shared utilises** :
- `ConfirmModal` (deja utilise par delivery + roadmap, 12 usages)

**Composants locaux existants reutilises** :
- `DocumentSelector.handleDelete` (logique deja en place)

**Design tokens references** :
- `var(--error)` (bouton danger)
- `var(--spacing-md)` (padding)

**Nouveau pattern ?** non — j'utilise uniquement l'existant.

**Tu confirmes ? (reponds « oui » pour debloquer)**
```

Cette presentation est **obligatoire** avant chaque premiere ecriture —
elle force Claude a reflechir a la reutilisation, et elle donne au user
le dernier mot avant modification.
