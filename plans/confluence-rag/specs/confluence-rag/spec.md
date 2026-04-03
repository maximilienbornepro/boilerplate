## ADDED Requirements

### Requirement: Module RAG accessible depuis la navigation principale
Le système DOIT exposer le module `confluence-rag` comme une application dans la SharedNav, accessible via la route `/confluence-rag`, avec le même système de permissions que les autres modules.

#### Scenario: Accès avec permission
- **QUAND** un utilisateur possède la permission `confluence-rag`
- **ALORS** le module apparaît dans la navigation principale
- **ET** la route `/confluence-rag` est accessible

#### Scenario: Accès sans permission
- **QUAND** un utilisateur n'a pas la permission `confluence-rag`
- **ALORS** le module n'apparaît pas dans la navigation
- **ET** la route `/confluence-rag` redirige vers la page d'accueil

---

### Requirement: Chat full-screen avec sidebar de conversations
Le système DOIT afficher une interface de chat en plein écran avec une sidebar listant les conversations et une zone principale de chat.

#### Scenario: Affichage initial sans conversation
- **QUAND** l'utilisateur ouvre le module pour la première fois
- **ALORS** la sidebar affiche "Aucune conversation"
- **ET** la zone de chat affiche un message d'accueil avec des exemples de questions

#### Scenario: Création d'une nouvelle conversation
- **QUAND** l'utilisateur envoie un premier message
- **ALORS** une nouvelle conversation est créée automatiquement
- **ET** son titre est généré depuis le premier message (tronqué à 60 caractères)
- **ET** la conversation apparaît en tête de la sidebar

#### Scenario: Navigation entre conversations
- **QUAND** l'utilisateur clique sur une conversation dans la sidebar
- **ALORS** les messages de cette conversation sont affichés dans la zone principale

#### Scenario: Suppression d'une conversation
- **QUAND** l'utilisateur supprime une conversation
- **ALORS** elle disparaît de la sidebar
- **ET** tous ses messages sont supprimés en base

---

### Requirement: Envoi de messages avec streaming SSE
Le système DOIT envoyer les messages utilisateur et diffuser les réponses de l'assistant en temps réel via Server-Sent Events.

#### Scenario: Envoi d'un message et réception de la réponse streamée
- **QUAND** l'utilisateur envoie un message
- **ALORS** le message utilisateur s'affiche immédiatement dans le chat
- **ET** un curseur animé indique que l'assistant génère sa réponse
- **ET** les tokens de la réponse s'affichent au fur et à mesure
- **ET** les sources sont affichées sous la réponse après complétion

#### Scenario: Markdown dans les réponses
- **QUAND** la réponse de l'assistant contient du markdown
- **ALORS** les titres, listes, code et liens sont rendus correctement

#### Scenario: Sources affichées avec liens
- **QUAND** des chunks Confluence sont retrouvés
- **ALORS** chaque source affiche le titre de la page et un lien cliquable vers Confluence

#### Scenario: Erreur de génération
- **QUAND** le LLM ou l'embedding API est indisponible
- **ALORS** un message d'erreur inline s'affiche dans le chat
- **ET** l'interface reste utilisable pour envoyer d'autres messages

---

### Requirement: Sélection et indexation des espaces Confluence
Le système DOIT permettre à l'utilisateur de sélectionner les espaces Confluence à indexer et de déclencher l'indexation manuellement.

#### Scenario: Affichage des espaces disponibles
- **QUAND** l'utilisateur ouvre le sélecteur d'espaces
- **ALORS** la liste des espaces Confluence auxquels il a accès s'affiche
- **ET** les espaces déjà sélectionnés sont cochés

#### Scenario: Déclenchement de l'indexation
- **QUAND** l'utilisateur sélectionne des espaces et clique "Indexer"
- **ALORS** l'indexation démarre en arrière-plan
- **ET** un indicateur de progression est affiché
- **ET** le statut se met à jour toutes les 3 secondes

#### Scenario: Confluence non configuré
- **QUAND** les variables `CONFLUENCE_BASE_URL` ou `JIRA_API_TOKEN` sont absentes
- **ALORS** le sélecteur d'espaces affiche "Confluence non configuré"
- **ET** le bouton d'indexation est désactivé
- **ET** l'upload Postman reste disponible

---

### Requirement: Upload et indexation de collections Postman
Le système DOIT permettre d'uploader des collections Postman JSON pour les indexer comme source de connaissance API.

#### Scenario: Upload réussi
- **QUAND** l'utilisateur upload un fichier JSON de collection Postman valide
- **ALORS** la collection est parsée en chunks (endpoints, descriptions, exemples)
- **ET** les chunks sont indexés avec leurs embeddings
- **ET** un toast "Collection indexée (N endpoints)" s'affiche

#### Scenario: Fichier invalide
- **QUAND** l'utilisateur upload un fichier qui n'est pas une collection Postman valide
- **ALORS** un message d'erreur s'affiche
- **ET** aucun chunk n'est créé en base

---

### Requirement: Providers LLM et embedding configurables
Le système DOIT supporter plusieurs providers LLM et embedding via variables d'environnement, sans nécessiter de recompilation.

#### Scenario: Provider Anthropic (défaut)
- **QUAND** `LLM_PROVIDER=anthropic` et `ANTHROPIC_API_KEY` est défini
- **ALORS** Claude Sonnet est utilisé pour la génération
- **ET** le module démarre sans erreur

#### Scenario: Provider Scaleway
- **QUAND** `LLM_PROVIDER=scaleway` et `EMBEDDING_PROVIDER=scaleway` sont définis avec les clés appropriées
- **ALORS** les modèles Scaleway sont utilisés pour les embeddings et la génération

#### Scenario: Changement de provider (dimension différente)
- **QUAND** le provider d'embedding change et que la dimension des vecteurs est différente
- **ALORS** la table `chunks` est automatiquement recréée au démarrage
- **ET** une ré-indexation est nécessaire (message dans les logs)
