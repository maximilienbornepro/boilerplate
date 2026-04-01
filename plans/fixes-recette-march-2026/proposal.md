# Proposal : Corrections Recette Mars 2026

## Pourquoi
Suite à la recette du 31/03/2026, plusieurs bugs et améliorations UX ont été identifiés sur 4 modules : Congés, SuiviTess, Mon CV, et Global (typographie).

## Ce qui change
- **Congés** : correction bug membre, admin dropdown, cacher champ membre pour non-admin, alerte weekend/férié améliorée, hauteur lignes calendrier, pleine largeur filtre année, restriction drag&drop à son user
- **Global** : fix encodage accents (CSS/font)
- **SuiviTess** : drag&drop reorder lignes, responsable par ligne, pictogrammes plus visibles
- **Mon CV** : import photo, reorder éléments (compétences, expériences, formations, projets, technologies), hauteur auto champs texte, fix Puppeteer, édition manuelle adaptations, lancer recommandation IA depuis détail, wording CTA

## Critères d'acceptation
1. Admin peut poser un congé pour n'importe quel membre via dropdown
2. Non-admin ne voit pas le champ "Membre"
3. Alerte visuelle si congé sur weekend/jour férié
4. Hauteur lignes calendrier augmentée (lisibilité)
5. Calendrier pleine largeur avec filtre "Années"
6. Drag&drop congés limité à ses propres congés
7. Les accents s'affichent correctement partout
8. Lignes SuiviTess reorderable par drag&drop
9. Champ responsable éditable par ligne SuiviTess
10. Pictogrammes "Validé"/"Supprimé" bien visibles
11. Photo importée correctement dans Mon CV
12. Tous les éléments listés (compétences, expériences…) reorderables
13. Champs texte s'auto-redimensionnent au contenu
14. PDF généré sans erreur Puppeteer
15. Modifications manuelles d'une adaptation sauvegardées
16. Recommandation IA lancable depuis le détail d'adaptation
17. CTA "Adapter le CV" et "Recommandation IA" avec wording distinct et clair
