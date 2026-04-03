## Exigences ajoutées

### Exigence : Créer un snapshot
Le système DOIT permettre de créer un snapshot manuel stockant l'état complet du document (sections + sujets) en JSONB.

#### Scénario : Snapshot manuel
- **QUAND** l'utilisateur clique sur "Sauvegarder"
- **ALORS** un snapshot est créé avec toutes les données du document

### Exigence : Historique des snapshots
Le système DOIT afficher la liste chronologique des snapshots d'un document.

#### Scénario : Voir l'historique
- **QUAND** l'utilisateur ouvre le panel historique
- **ALORS** la liste des snapshots s'affiche avec dates et types

### Exigence : Restaurer un snapshot
Le système DOIT permettre de restaurer un document à l'état d'un snapshot précédent.

#### Scénario : Restauration
- **QUAND** l'utilisateur restaure un snapshot après confirmation
- **ALORS** les sections et sujets actuels sont remplacés par ceux du snapshot

### Exigence : Diff entre versions
Le système DOIT calculer les différences entre l'état courant et le dernier snapshot.

#### Scénario : Afficher le diff
- **QUAND** l'utilisateur consulte les modifications
- **ALORS** le système affiche les sujets ajoutés, modifiés, et les changements de statut
