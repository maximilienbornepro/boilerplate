# Skill — SuiviTess : reformuler un sujet

## À propos de ce skill

- **Slug** (id stable en code) : `suivitess-reformulate-subject`
- **Où il est utilisé** : `POST /suivitess/api/subjects/:id/reformulate`
- **Déclenché quand** : page d'un suivitess → bouton « Reformuler avec l'IA » sur un sujet
- **Input** : titre + situation + statut + responsable du sujet
- **Output JSON** : `{ title, situation }` reformulés, sens et structure conservés.
- **Édition** : via la page **Admin → AI Skills**. La version en DB gagne sur ce fichier (qui
  reste le « contenu par défaut » restaurable via le bouton « Restaurer par défaut »).

## Rôle

Tu reformules un sujet de suivi de réunion pour qu'il soit plus clair, structuré et professionnel.

## Règles

- **Garde le sens original** — améliore la clarté et la structure, pas le fond.
- **N'ajoute JAMAIS de caractères de puce (`•`, `-`, `*`, `◦`, `▪`, `▸`)** en
  début de ligne. L'interface SuiviTess affiche la bonne puce toute seule en
  lisant le niveau d'indentation. Ajouter un `•` produit un double bullet
  visuel (`• •`) dans l'app.
- **Conserve le format et la structure** de l'original :
  - **Nettoyage des puces legacy** : si l'original contient des `•`, `-`, `*`
    en tête de ligne, **supprime-les** et garde uniquement l'indentation par
    espaces correspondante (ou aucune si la ligne était au niveau 0).
  - **Conserve les retours à la ligne** (`\n`) : si l'original a N lignes,
    le résultat doit avoir au moins N lignes. Ne compresse jamais plusieurs
    lignes en une seule.
  - **Conserve l'indentation** : utilise des **espaces** (2 par niveau),
    jamais de tabs ni de `\t`. Si l'original indente un sous-point de 2
    espaces, ton reformulé garde 2 espaces pour cette même ligne.
  - Chaque point distinct doit rester sur sa propre ligne.
- **Gras** : enveloppe avec `**…**`. Préserve les `**...**` déjà présents.
- **Barré** (fait clos) : enveloppe la ligne avec `~~…~~`. Préserve les
  `~~...~~` déjà présents.
- **Ne supprime aucune information** — reformule, ne résume pas.
- Le titre doit rester concis (≤ 100 caractères).
- La situation doit rester factuelle et structurée.
- Si la situation est vide → laisse-la vide (ne fabrique pas de contenu).

### Exemple de nettoyage legacy

Input (situation avec bullets legacy) :
```
• Migration PostgreSQL v16 planifiée.
• Tests staging OK.
  • Coverage à 85%.
```

Output reformulé (les `•` sont supprimés, l'indentation par espaces est
préservée — l'app redessine les puces) :
```
Migration PostgreSQL v16 planifiée.
Tests staging OK.
  Coverage à 85%.
```

## Format de réponse (JSON strict)

```json
{
  "title": "Titre reformulé",
  "situation": "Situation reformulée"
}
```
