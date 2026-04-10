# Delivery Board Import - Plugin Figma

Plugin Figma pour importer les taches du Delivery Board directement dans Figma.

## Installation

1. Ouvrir **Figma Desktop** (obligatoire pour les plugins locaux)
2. Menu `Plugins` > `Development` > `Import plugin from manifest...`
3. Selectionner le fichier `manifest.json` de ce dossier

## Prerequis

- Le serveur Delivery doit etre accessible via ngrok (ou autre tunnel)
- L'URL ngrok doit pointer vers le port 3002 du serveur Delivery

## Utilisation

1. Lancer le plugin : `Plugins` > `Development` > `Delivery Board Import`
2. Entrer l'URL ngrok du serveur (ex: `https://francet-tv.ngrok.app`)
3. Selectionner le **projet** (TVSMART, TVFREE, etc.)
4. Entrer le **PI** (ex: PI2, PI3)
5. Cliquer **Charger les taches**
6. Verifier l'apercu des taches chargees
7. Cliquer **Importer les taches** ou **Importer les releases**

## Fonctionnalites

### Importer les taches

Cree une carte SVG pour chaque tache avec :
- Badge JIRA (couleur par projet)
- Badge estimation (jours)
- Titre de la tache
- Badge statut
- Badge version

Les taches sont positionnees selon leur position sauvegardee sur le Delivery Board (si disponible), sinon en grille.

### Importer les releases

Cree un tableau SVG avec toutes les versions et leurs recits associes.

## Configuration du serveur

Le serveur Delivery expose l'API Figma sur `/api/figma/` :

| Endpoint | Description |
|----------|-------------|
| `GET /api/figma/projects` | Liste des projets disponibles |
| `GET /api/figma/tasks/:projectId/:piId` | Taches avec SVG pour un projet/PI |

### Demarrer le serveur avec ngrok

```bash
# Terminal 1: Demarrer le serveur
cd delivery-process
npm run dev

# Terminal 2: Exposer via ngrok
ngrok http 3002
```

## Fichiers

| Fichier | Description |
|---------|-------------|
| `manifest.json` | Configuration du plugin Figma |
| `code.js` | Logique principale (sandbox Figma) |
| `ui.html` | Interface utilisateur |

## Developpement

Pour modifier le plugin :

1. Editer les fichiers
2. Dans Figma : `Plugins` > `Development` > `Delivery Board Import` (le plugin se recharge automatiquement)

## Couleurs par projet

| Projet | Couleur |
|--------|---------|
| TVSMART | Bleu (#dbeafe) |
| TVFREE | Gris (#f3f4f6) |
| TVORA | Orange (#ffedd5) |
| TVSFR | Rouge (#fee2e2) |
| TVFIRE | Jaune (#fef9c3) |
