# Plan — SuiviTess : import de transcriptions au niveau de la liste

## Objectif

Ajouter un bouton **"✨ Importer & ranger"** sur la page de liste des reviews SuiviTess
(`DocumentSelector`) qui :

1. Ouvre une modale qui récupère les transcriptions & mails récents (Fathom, Otter, Gmail, Outlook)
   depuis les providers déjà configurés par l'utilisateur.
2. Pour **chaque item**, l'IA **suggère une review SuiviTess de destination** (existante ou nouvelle)
   en analysant le titre et, si besoin, le contenu.
3. L'utilisateur **valide ou modifie** la destination pour chaque item (dropdown listant les reviews
   existantes + option « nouvelle review »).
4. Au clic sur « Importer », chaque item est importé dans sa review de destination en réutilisant
   l'endpoint existant `POST /suivitess-api/documents/:docId/transcript-import`.

La logique de routing (comment l'IA choisit la review) vit dans un **skill markdown éditable**, dans
la même approche que `sanity-check-skill.md`.

## Ce qui existe déjà (à réutiliser)

- `TranscriptionWizard` (component interne à un document) avec ses providers Fathom / Otter / Gmail /
  Outlook.
- `GET /suivitess-api/transcription/calls?provider=...` : liste les calls (Fathom/Otter).
- `GET /suivitess-api/email/list?provider=...` : liste les mails récents.
- `GET /suivitess-api/email/body/:messageId` : corps d'un mail.
- `POST /suivitess-api/documents/:docId/transcript-import` : importe 1 transcription dans 1 document,
  crée une section + sujets (via IA si demandé).
- `GET /suivitess-api/documents` : liste les reviews existantes (pour le choix de destination).

## Nouveautés

### 1. Skill éditable
Fichier : `apps/platform/servers/unified/src/modules/suivitess/transcription-routing-skill.md`

Contient :
- Règles de choix d'une review existante vs création d'une nouvelle.
- Critères d'analyse (titre du call, date, intervenants, mots-clés, récurrence hebdo/mensuelle).
- Format JSON strict attendu en sortie IA.

Chargé à chaque appel (`readFile`) — modifiable sans redéploiement en dev.

### 2. Nouveau service backend
`apps/platform/servers/unified/src/modules/suivitess/transcriptionRoutingService.ts`

```ts
export interface SourceItem {
  id: string;                   // callId ou messageId
  provider: 'fathom' | 'otter' | 'gmail' | 'outlook';
  title: string;
  date: string;
  participants?: string[];
  preview?: string;
}

export interface ExistingReview {
  id: string;
  title: string;
  description: string | null;
}

export interface RoutingSuggestion {
  itemId: string;
  suggestedAction: 'existing' | 'new';
  suggestedDocId: string | null;   // pour 'existing'
  suggestedNewTitle: string | null; // pour 'new' (template de titre proposé)
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export async function suggestRouting(
  userId: number,
  items: SourceItem[],
  existingReviews: ExistingReview[],
): Promise<{ summary: string; suggestions: RoutingSuggestion[] }>
```

Appelle Claude avec le skill + la liste des items + la liste des reviews existantes → retourne un
mapping `itemId → destination`.

### 3. Nouvelles routes

- `GET /suivitess-api/transcription/bulk-sources` (agrège calls + emails de tous les providers
  connectés) → returns `SourceItem[]`.
- `POST /suivitess-api/transcription/route-suggestions` (body: array de `SourceItem` + reviews
  existantes) → appelle l'IA et retourne `suggestions[]`. Coût crédits : `routing_analysis` = 2.
- L'import lui-même passe par l'endpoint existant `POST /documents/:docId/transcript-import`,
  appelé en parallèle côté frontend pour chaque item validé.

### 4. Frontend

- `apps/platform/src/modules/suivitess/components/BulkTranscriptionImportModal/`
  - `BulkTranscriptionImportModal.tsx` (modale xl avec liste des items + dropdown de destination
    par item + bouton « Nouvelle review » par item).
  - `BulkTranscriptionImportModal.module.css`.
  - Étapes :
    1. **Loading** : fetch des sources + reviews + suggestions IA en parallèle.
    2. **Routing** : liste des items avec leur destination suggérée (éditable).
    3. **Importing** : progress bar (`N/total`).
    4. **Done** : résumé (X importés dans review A, Y dans review B).
- `DocumentSelector.tsx` : ajouter un bouton **« ✨ Importer & ranger »** à côté de
  « + Nouvelle review ». Visible si au moins un provider transcription/email est connecté.
- `services/api.ts` : `fetchBulkSources()`, `fetchRoutingSuggestions(items, reviews)`.

## Règles du skill (première version)

1. Si un item a un titre qui **contient explicitement** le nom ou la description d'une review
   existante → suggère cette review (confidence = high).
2. Si un item est un **call récurrent** (ex. "Hebdo Tech", "Weekly", "Daily") et qu'une review au
   titre similaire existe → suggère cette review.
3. Si un item ne correspond à aucune review → suggère la **création d'une nouvelle review**, avec
   un titre template (confidence = medium).
4. Pour un mail Outlook/Gmail, regarde surtout le **sujet** et les **participants** ; pour un call
   Fathom/Otter, regarde le **titre** + les **intervenants**.
5. Ne propose **jamais** de supprimer ou de fusionner une review existante.

## Crédits

- `routing_analysis` : **2 crédits** par appel (analyse "légère" : juste du routing, pas d'extraction
  de sujets).
- L'extraction des sujets dans chaque review reste sur `transcript_analysis` = 10 crédits, appelé
  côté `/transcript-import` déjà existant.

## Tests

- Backend (`__tests__/suivitess/transcription-routing.test.ts`) :
  - `buildPrompt` inclut les items et les reviews.
  - Validation : ne pas suggérer un `suggestedDocId` absent de `existingReviews`.
  - Cap à 50 items.
- Frontend (`__tests__/transcription-routing.test.ts`) :
  - Le bouton n'apparaît pas si aucun provider n'est connecté.
  - Le payload d'import par item contient le bon `docId` choisi (suggestion vs override).

## Fichiers à créer / modifier

| # | Fichier | Action |
|---|---------|--------|
| 1 | `apps/platform/servers/unified/src/modules/suivitess/transcription-routing-skill.md` | **Nouveau** — skill éditable |
| 2 | `apps/platform/servers/unified/src/modules/suivitess/transcriptionRoutingService.ts` | **Nouveau** — analyse IA routing |
| 3 | `apps/platform/servers/unified/src/modules/suivitess/routes.ts` | Ajouter 2 routes (bulk-sources, route-suggestions) |
| 4 | `apps/platform/servers/unified/src/modules/connectors/creditService.ts` | Ajouter `routing_analysis` = 2 |
| 5 | `apps/platform/servers/unified/src/modules/__tests__/suivitess/transcription-routing.test.ts` | **Nouveau** tests backend |
| 6 | `apps/platform/src/modules/suivitess/services/api.ts` | Ajouter `fetchBulkSources` + `fetchRoutingSuggestions` |
| 7 | `apps/platform/src/modules/suivitess/components/BulkTranscriptionImportModal/BulkTranscriptionImportModal.tsx` | **Nouveau** |
| 8 | `apps/platform/src/modules/suivitess/components/BulkTranscriptionImportModal/BulkTranscriptionImportModal.module.css` | **Nouveau** |
| 9 | `apps/platform/src/modules/suivitess/components/DocumentSelector/DocumentSelector.tsx` | Ajouter le bouton + gestion de la modale |
| 10 | `apps/platform/src/modules/suivitess/__tests__/transcription-routing.test.ts` | **Nouveau** tests frontend |

## Branche

`feat/suivitess-list-transcription-import` (déjà créée).
