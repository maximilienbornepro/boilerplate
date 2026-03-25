## Exigences ajoutées

### Exigence : Créer un marqueur
Le système DOIT permettre de créer un marqueur (jalon) avec nom, date, couleur et type sur un planning.

#### Scénario : Création d'un marqueur
- **QUAND** l'utilisateur crée un marqueur avec une date et un nom
- **ALORS** le marqueur apparaît comme une ligne verticale sur le Gantt à la date spécifiée

### Exigence : Modifier un marqueur
Le système DOIT permettre de modifier un marqueur existant, y compris par drag & drop sur la timeline.

#### Scénario : Modification par drag
- **QUAND** l'utilisateur drag un marqueur horizontalement
- **ALORS** la date du marqueur est mise à jour

#### Scénario : Modification par formulaire
- **QUAND** l'utilisateur modifie les propriétés d'un marqueur
- **ALORS** les changements sont sauvegardés

### Exigence : Supprimer un marqueur
Le système DOIT permettre de supprimer un marqueur.

#### Scénario : Suppression d'un marqueur
- **QUAND** l'utilisateur supprime un marqueur
- **ALORS** la ligne verticale disparaît du Gantt

### Exigence : Types de marqueurs
Les marqueurs DOIVENT supporter plusieurs types : `milestone`, `deadline`, `release`.

#### Scénario : Rendu visuel par type
- **QUAND** un marqueur est affiché
- **ALORS** son apparence varie selon son type (couleur, icône, style de ligne)

### Exigence : Endpoints API des marqueurs

#### Scénario : GET marqueurs d'un planning
- **QUAND** le client envoie `GET /roadmap/api/plannings/:id/markers`
- **ALORS** le serveur retourne tous les marqueurs du planning

#### Scénario : POST créer un marqueur
- **QUAND** le client envoie `POST /roadmap/api/markers`
- **ALORS** le serveur crée le marqueur avec UUID

#### Scénario : PUT modifier un marqueur
- **QUAND** le client envoie `PUT /roadmap/api/markers/:id`
- **ALORS** le serveur met à jour les champs fournis

#### Scénario : DELETE supprimer un marqueur
- **QUAND** le client envoie `DELETE /roadmap/api/markers/:id`
- **ALORS** le serveur supprime le marqueur
