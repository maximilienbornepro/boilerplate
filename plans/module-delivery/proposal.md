## Pourquoi

Le boilerplate a besoin d'un module de board de sprint planning visuel avec grille drag & drop. Permet d'organiser des tâches sur une grille 6 colonnes (sprints) avec positionnement libre, incréments, confidence index, et snapshots.

## Ce qui change

- **Nouveau module** `delivery` — board de planning sprint avec grille drag & drop
- **Tâches locales en DB** — pas de connexion Jira, les tâches sont gérées localement
- **Incréments** (renommé de PI) — périodes de 6 semaines avec sélecteur
- **Design system fidèle** — tous les composants visuels portés depuis delivery-process (TaskBlock, DeviceRow, SprintColumn, markers, etc.)

## Ce qui est porté

- Board visuel avec grille 6 colonnes × N lignes
- TaskBlock avec badges (type, statut, estimé, assigné)
- Drag & drop des tâches sur la grille (positionnement libre)
- SprintColumn headers
- TodayMarker (ligne verticale)
- Confidence Index widget
- Snapshot/historique
- Increment selector (ex-PI selector)
- Freeze d'increment
- Hidden tasks (masquer/restaurer)

## Ce qui est retiré

| Élément | Raison |
|---------|--------|
| Connexion Jira | Tâches gérées localement |
| Projets multiples (TVSMART, etc.) | Board générique unique |
| Vue "All Projects" | Pas de multi-projet |
| Vue "Chronological" | Pas nécessaire pour le boilerplate |
| Roadmap SFR | Spécifique delivery-process |
| Export Figma | Spécifique delivery-process |
| Delivery Rules / JQL | Pas de Jira |
| Anomalies (bugs Jira) | Pas de Jira |
| OAuth Jira | Pas de Jira |

## Impact

- **Frontend** : `apps/platform/src/modules/delivery/`
- **Backend** : `apps/platform/servers/unified/src/modules/delivery/`
- **Base de données** : `database/init/07_delivery_schema.sql`
- **Configuration** : router, vite, nav, gateway, vitest, package.json
