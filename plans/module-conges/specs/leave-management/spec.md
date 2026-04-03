## Exigences ajoutées

### Exigence : Créer un congé
Le système DOIT permettre aux utilisateurs de créer un congé avec : membre, date de début, date de fin, période de début, période de fin, et motif optionnel.

#### Scénario : Créer un congé journée complète
- **QUAND** l'utilisateur remplit le formulaire avec des dates valides et soumet
- **ALORS** le congé est créé et le calendrier se rafraîchit pour l'afficher

#### Scénario : Créer un congé demi-journée
- **QUAND** l'utilisateur sélectionne "matin" ou "après-midi" pour la période de début ou fin
- **ALORS** le congé est créé avec les périodes demi-journée spécifiées

#### Scénario : Plage de dates invalide
- **QUAND** l'utilisateur soumet un congé où la date de début est après la date de fin
- **ALORS** le système rejette la requête avec une erreur de validation

### Exigence : Modifier un congé
Le système DOIT permettre la modification des dates, périodes et motif d'un congé existant.

#### Scénario : Modifier son propre congé en tant qu'utilisateur standard
- **QUAND** un utilisateur non-admin clique sur son propre congé dans le calendrier
- **ALORS** le formulaire d'édition s'ouvre pré-rempli avec les données du congé

#### Scénario : Modifier n'importe quel congé en tant qu'admin
- **QUAND** un utilisateur admin clique sur n'importe quel congé dans le calendrier
- **ALORS** le formulaire d'édition s'ouvre pré-rempli avec les données du congé

#### Scénario : Impossible de modifier les congés d'autrui en tant qu'utilisateur standard
- **QUAND** un utilisateur non-admin clique sur le congé d'un autre membre
- **ALORS** le formulaire d'édition NE s'ouvre PAS

### Exigence : Supprimer un congé
Le système DOIT permettre la suppression d'un congé avec une boîte de dialogue de confirmation.

#### Scénario : Suppression avec confirmation
- **QUAND** l'utilisateur clique sur supprimer et confirme
- **ALORS** le congé est supprimé et le calendrier se rafraîchit

#### Scénario : Annulation de la suppression
- **QUAND** l'utilisateur clique sur supprimer mais annule la confirmation
- **ALORS** le congé n'est pas supprimé

### Exigence : Endpoints API des congés
Le backend DOIT exposer des endpoints REST pour les opérations CRUD des congés, tous protégés par le middleware d'authentification.

#### Scénario : GET congés par plage de dates
- **QUAND** le client envoie `GET /conges/api/leaves?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- **ALORS** le serveur retourne tous les congés chevauchant la plage de dates

#### Scénario : POST créer un congé
- **QUAND** le client envoie `POST /conges/api/leaves` avec des données valides
- **ALORS** le serveur crée le congé et le retourne avec un UUID généré

#### Scénario : PUT modifier un congé
- **QUAND** le client envoie `PUT /conges/api/leaves/:id` avec les données mises à jour
- **ALORS** le serveur met à jour le congé et retourne l'enregistrement modifié

#### Scénario : DELETE supprimer un congé
- **QUAND** le client envoie `DELETE /conges/api/leaves/:id`
- **ALORS** le serveur supprime le congé et retourne un succès
