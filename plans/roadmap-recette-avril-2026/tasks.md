# Tâches : Roadmap — Corrections & Évolutions Recette Avril 2026

- [x] 1. **`dateUtils.ts`** — Ajouter weekends en vue Mois (width 20px, `isWeekend: true`) + `getWeekNumber()` ISO 8601 pour vue Trimestre (format "S{n}")
- [x] 2. **`GanttBoard.tsx/css`** — Header : nom du mois complet si espace dispo ; scroll initial vers mois courant ; styles weekends (fond `var(--bg-tertiary)`, width réduite)
- [x] 3. **`TaskBar.tsx/css`** — Inverser UI parente/sous-tâche : parente = fond plein 26px ; sous-tâche = bordure pointillée 18px couleur parente
- [x] 4. **`ViewSelector.tsx/css`** — Ajouter flèches prev/next année, CTA "Aujourd'hui", affichage période courante ; style repris de `ViewControls` module Congés
- [x] 5. **`App.tsx`** — Intégrer `yearOffset` state + `onYearOffsetChange` + `onTodayClick` ; CTA "Lien" → "Partager"
- [x] 6. **Mode embed** — Auditer et corriger bug affichage tâches/sous-tâches ; désactiver tous les handlers drag/resize quand `readOnly=true` ; scroll vers mois courant en embed
- [x] 7. **Tests unitaires** — Tester `getWeekNumber()`, colonnes weekends, cycle couleurs + `npm test`
