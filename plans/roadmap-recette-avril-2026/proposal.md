# Proposal : Roadmap — Corrections & Évolutions Recette Avril 2026

## Pourquoi
Suite à la recette du 2 avril 2026, 14 points d'amélioration ont été identifiés sur le module Roadmap : problèmes d'affichage calendrier, navigation temporelle manquante, incohérences UI parente/sous-tâche, mode embed partiellement dysfonctionnel, et libellés à corriger.

## Ce qui change
- **Calendrier** : weekends visibles en vue Mois, scroll initial centré sur le mois courant, nom du mois affiché en entier
- **Navigation** : filtre Année + CTA "Aujourd'hui" (style Congés), vue Trimestre avec numéros de semaine S12
- **Mode embed** : correction affichage tâches/sous-tâches, désactivation drag & drop et redimensionnement, scroll vers mois courant
- **UI tâches** : inversion visuelle parente/sous-tâche, couleur auto-générée à chaque création
- **Wording** : CTA "Lien" → "Partager"

## Capacités
- `weekends-visible` : affichage des weekends en vue Mois avec fond grisé et largeur réduite
- `year-navigation` : navigation prev/next année + CTA "Aujourd'hui"
- `week-numbers` : numéros de semaine ISO (S1…S52) en vue Trimestre
- `task-ui-inversion` : parente = fond plein grande barre ; sous-tâche = petite barre bordure pointillée
- `embed-fixes` : mode lecture seule sans drag/resize, centré sur mois courant

## Critères d'acceptation
1. En vue Mois : weekends affichés fond grisé, largeur 20px (vs 40px jours ouvrés)
2. À l'ouverture : vue centrée sur le mois courant
3. Nom du mois affiché en entier dans le header quand l'espace le permet
4. Sélecteur Année + CTA "Aujourd'hui" présent, style Congés
5. Vue Trimestre : colonnes "S1", "S12"… au lieu des dates
6. Mode embed : drag & drop désactivé, resize désactivé, vue centrée mois courant
7. Mode embed : tâches et sous-tâches s'affichent correctement
8. Tâche parente : barre haute 26px + fond plein couleur ; sous-tâche : barre 18px + bordure pointillée couleur parente
9. Chaque nouvelle tâche parente reçoit une couleur unique (cycle palette)
10. Bouton "Lien" renommé "Partager"
