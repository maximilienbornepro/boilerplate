# Tâches : Corrections Recette Mars 2026

## Module Congés
- [x] 1. **Bug membre** : dans `LeaveForm.tsx`, utiliser `useGatewayUser()` pour forcer `memberId = currentUser.id` si non-admin
- [x] 2. **Admin dropdown** : afficher `<select>` membres uniquement si `currentUser.isAdmin`
- [x] 3. **Cacher champ Membre non-admin** : masquer l'élément si non-admin
- [x] 4. **Alerte weekend/férié** : améliorer l'affichage du warning (couleur, icône, message clair)
- [x] 5. **Hauteur lignes calendrier** : augmenter `ROW_HEIGHT` (56px → 72px) dans `LeaveCalendar.tsx` + CSS
- [x] 6. **Pleine largeur filtre années** : corriger le CSS quand `viewMode === 'year'`
- [x] 7. **Drag&drop restriction** : n'autoriser le drag que sur les `LeaveBar` dont `leave.userId === currentUser.id`

## Module Global
- [x] 8. **Typographie accents** : vérifier et corriger `font-family` / `charset` dans `theme.css` ou `index.html`

## Module SuiviTess
- [x] 9. **Reorder lignes** : ajouter drag&drop dans `ReviewWizard.tsx` sur la liste des sujets, appeler `reorderSubjects()` API
- [x] 10. **Responsable par ligne** : ajouter champ `responsibility` éditable dans `SubjectReview.tsx`
- [x] 11. **Pictogrammes visibilité** : agrandir/styler les emojis de statut dans `SubjectReview.module.css`

## Module Mon CV
- [x] 12. **Import photo** : corriger `ImportCVModal.tsx` pour inclure `profilePhoto` dans le mapping des données importées
- [ ] 13. **Reorder compétences** (langues, outils, frameworks, dev, solutions) : drag&drop dans `MyProfilePage.tsx` / `AdaptCVPage.tsx`
- [ ] 14. **Reorder expériences et formations** : drag&drop sur les listes `experiences[]` et `formations[]`
- [ ] 15. **Reorder projets et technologies** : drag&drop dans `ProjectEditor.tsx`
- [x] 16. **Hauteur auto champs texte** : appliquer `autoResize` sur tous les `<textarea>` de `AdaptCVPage.tsx` et `AdaptationDetailPage.tsx`
- [x] 17. **Fix Puppeteer** : dans `routes.ts`, ajouter `executablePath` avec détection du chemin Chrome selon l'environnement
- [x] 18. **Édition manuelle adaptation** : compléter l'UI d'édition dans `AdaptationDetailPage.tsx` pour persister via `updateAdaptation()`
- [x] 19. **Recommandation IA depuis détail** : ajouter bouton + appel `getAtsRecommendations()` + panel dans `AdaptationDetailPage.tsx`
- [x] 20. **Wording CTA** : renommer "Adapter le CV" → "Adapter automatiquement" et "Recommandation IA" → "Analyser & recommander"
