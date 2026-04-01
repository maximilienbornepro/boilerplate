# Design : Corrections Recette Mars 2026

## Décisions techniques

1. **Drag&drop** : utiliser `@dnd-kit/core` si présent, sinon HTML5 drag natif — pas de nouvelle dépendance
2. **Admin dropdown congés** : récupérer `currentUser` via `useGatewayUser()`, si `isAdmin` afficher `<select>` membres, sinon forcer `memberId = currentUser.id`
3. **Puppeteer** : ajouter `executablePath` dynamique avec fallback sur les paths connus de Chrome/Chromium selon l'OS/env
4. **Hauteur textarea** : `useEffect` + `ref` pour auto-resize à chaque changement de valeur
5. **Reorder** : pattern drag&drop avec `onDragEnd` qui appelle l'API puis met à jour l'état local

## Fichiers impactés

| Fichier | Description |
|---------|-------------|
| `conges/components/LeaveForm/LeaveForm.tsx` | Bug membre + admin dropdown + alerte weekend |
| `conges/components/LeaveCalendar/LeaveCalendar.tsx` | Hauteur lignes + largeur filtre année + drag restriction |
| `conges/components/LeaveCalendar/LeaveBar.module.css` | Hauteur lignes CSS |
| `suivitess/components/SubjectReview/SubjectReview.tsx` | Responsable par ligne + pictogrammes |
| `suivitess/components/SubjectReview/SubjectReview.module.css` | Style pictogrammes |
| `suivitess/components/ReviewWizard/ReviewWizard.tsx` | Reorder drag&drop |
| `mon-cv/components/MyProfilePage/MyProfilePage.tsx` | Import photo |
| `mon-cv/components/AdaptCVPage/AdaptCVPage.tsx` | Reorder compétences + hauteur champs + wording |
| `mon-cv/components/AdaptationDetailPage/AdaptationDetailPage.tsx` | Édition manuelle + recommandation IA |
| `mon-cv/components/ProjectEditor/ProjectEditor.tsx` | Reorder projets/technologies |
| `packages/shared/src/styles/theme.css` | Fix accents typographie |
| `apps/platform/servers/unified/src/modules/mon-cv/routes.ts` | Fix Puppeteer chromium path |

## Flux principaux

### Bug membre congés
```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant F as LeaveForm
    participant A as API Congés
    participant D as DB

    U->>F: Ouvre modale "Poser un congé"
    F->>F: useGatewayUser() → currentUser
    alt Admin
        F-->>U: Affiche dropdown membres
        U->>F: Sélectionne un membre
    else Non-admin
        F->>F: memberId = currentUser.id (forcé)
        F-->>U: Champ "Membre" masqué
    end
    U->>F: Remplit dates
    F->>F: Vérifie weekend/jour férié
    alt Dates problématiques
        F-->>U: Alerte warning visible
    end
    U->>F: Confirme
    F->>A: POST /conges-api/leaves { memberId, ... }
    A->>D: INSERT avec le bon member_id
    D-->>A: ok
    A-->>F: 201 { leave }
    F-->>U: Toast succès + calendrier mis à jour
```

### Reorder SuiviTess
```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant W as ReviewWizard
    participant A as API SuiviTess

    U->>W: Drag une ligne de sujet
    W->>W: onDragEnd → calcule nouvelle position
    W->>W: Met à jour subjects[] localement (optimistic)
    W->>A: PUT /suivitess-api/sections/:id/subjects/reorder
    A-->>W: 200 ok
    W-->>U: Ordre persisté
```

### Recommandation IA depuis détail adaptation
```mermaid
sequenceDiagram
    participant U as Utilisateur
    participant D as AdaptationDetailPage
    participant A as API Mon CV
    participant AI as Claude API

    U->>D: Clique "Analyser & recommander"
    D->>A: POST /mon-cv-api/adaptations/:id/recommendations
    A->>AI: Prompt avec CVData + jobOffer
    AI-->>A: AtsRecommendations
    A-->>D: { recommendations[] }
    D-->>U: Affiche panel recommandations
    U->>D: Applique une recommandation
    D->>D: Met à jour adaptedData localement
    D->>A: PUT /mon-cv-api/adaptations/:id
    A-->>D: ok
```
