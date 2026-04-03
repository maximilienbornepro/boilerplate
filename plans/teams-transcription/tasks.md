# Tasks — teams-transcription

## 1. Base de données

- [x] 1.1 Créer `database/init/13_suivitess_recorder_schema.sql` avec les tables `suivitess_recordings` et `suivitess_suggestions`

## 2. Backend — Agent Puppeteer

- [x] 2.1 Installer `puppeteer` comme dépendance dans `apps/platform/servers/unified/`
- [x] 2.2 Créer `recorderAgent.ts` — script Puppeteer qui rejoint Teams (anonyme), active les sous-titres, collecte via MutationObserver, communique via IPC (stdout JSON messages)
- [x] 2.3 Ajouter gestion de la salle d'attente Teams et timeout 5 min dans l'agent
- [x] 2.4 Ajouter détection de fin de call (DOM `[data-tid="call-ended-screen"]` ou navigation) dans l'agent

## 3. Backend — Service d'enregistrement

- [x] 3.1 Créer `recorderService.ts` — spawn/stop processus Puppeteer, gestion de la Map en mémoire `recordingsByDocId`, persistance DB
- [x] 3.2 Créer les fonctions DB dans `dbService.ts` : `createRecording`, `updateRecordingStatus`, `saveTranscript`, `getRecordingByDocument`

## 4. Backend — Service de suggestions IA

- [x] 4.1 Créer `suggestionsService.ts` — appel Claude avec prompt (document suivitess + transcription), parse JSON suggestions
- [x] 4.2 Créer les fonctions DB dans `dbService.ts` : `createSuggestion`, `getSuggestions`, `updateSuggestionStatus`
- [x] 4.3 Implémenter `acceptSuggestion` — crée/met à jour Section ou Sujet selon le type de suggestion

## 5. Backend — Routes

- [x] 5.1 Ajouter dans `routes.ts` : `POST /documents/:docId/recorder/start` — valide l'URL Teams, démarre l'agent
- [x] 5.2 Ajouter dans `routes.ts` : `GET /documents/:docId/recorder/status` — retourne statut + captionCount
- [x] 5.3 Ajouter dans `routes.ts` : `POST /documents/:docId/recorder/stop` — arrête l'agent proprement
- [x] 5.4 Ajouter dans `routes.ts` : `GET /documents/:docId/suggestions` — liste les suggestions en attente
- [x] 5.5 Ajouter dans `routes.ts` : `POST /suggestions/:id/accept` et `POST /suggestions/:id/reject`

## 6. Frontend — RecorderBar

- [x] 6.1 Créer `components/RecorderBar/RecorderBar.tsx` — input lien Teams + bouton "Enregistrer" + badge de statut (idle/joining/recording/processing/done/error)
- [x] 6.2 Créer `RecorderBar.module.css` avec styles du badge (couleur selon statut)
- [x] 6.3 Ajouter le polling du statut toutes les 10s dans `RecorderBar` (useInterval hook)
- [x] 6.4 Intégrer `RecorderBar` dans l'en-tête du document suivitess (sous le `ModuleHeader`)

## 7. Frontend — SuggestionsPanel

- [x] 7.1 Créer `components/SuggestionsPanel/SuggestionsPanel.tsx` — panneau latéral avec liste des suggestions, boutons Accepter/Ignorer
- [x] 7.2 Créer `SuggestionsPanel.module.css`
- [x] 7.3 Intégrer le panneau dans la vue document — s'ouvre automatiquement quand statut=done et suggestions disponibles
- [x] 7.4 Créer `services/api.ts` pour les appels recorder (start, status, stop, suggestions, accept, reject)

## 8. Tests

- [x] 8.1 Créer `apps/platform/servers/unified/src/modules/__tests__/suivitess/recorder.test.ts` — tests : validation URL Teams, parse VTT, génération suggestions (logique pure)
- [x] 8.2 Créer `apps/platform/src/modules/suivitess/__tests__/recorder.test.ts` — tests : badge status display, polling logic, suggestions rendering
- [x] 8.3 Ajouter projets `server-suivitess-recorder` et `client-suivitess-recorder` dans `vitest.config.ts`
- [x] 8.4 Ajouter scripts `test:server:suivitess-recorder` et `test:client:suivitess-recorder` dans `package.json`
- [x] 8.5 Vérifier que `npm test` passe (577 tests, 27 fichiers — tous verts)
