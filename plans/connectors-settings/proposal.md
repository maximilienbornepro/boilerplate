## Pourquoi

Les modules du boilerplate (delivery, roadmap, etc.) ont besoin de se connecter à des services externes (Jira, Notion, ClickUp). Plutôt que de configurer via des variables d'environnement, chaque utilisateur configure ses connexions directement dans l'interface via une page "Connecteurs" dans les paramètres. Les credentials sont stockés par utilisateur en base de données.

## Ce qui change

- **Page Connecteurs** accessible depuis la navigation — formulaire par service
- **Table `user_connectors`** en DB — stocke les credentials par utilisateur/service en JSONB
- **API CRUD** pour les connecteurs — créer, modifier, tester, supprimer
- **Test de connexion Jira** — vérifie les credentials en appelant l'API Jira
- **Notion et ClickUp** en placeholder "Bientôt disponible"

## Capacités

### Nouvelles capacités
- `connector-management` : Configuration, test et gestion des connexions externes par utilisateur

## Impact

- **Frontend** : `gateway/components/ConnectorsPage.tsx` + CSS
- **Backend** : `modules/connectors/` (index, routes, dbService)
- **Base de données** : `database/init/09_connectors_schema.sql`
- **Navigation** : Bouton "Connecteurs" dans le header de la page d'accueil
