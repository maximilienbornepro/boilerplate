// Central registry of AI skills. Each skill is a markdown file shipped with
// the repository (default content) and may be overridden via the admin UI
// (stored in the `ai_skills` table). The `slug` is the stable id used in code
// and in the DB — renaming the file does not break anything as long as the
// slug stays the same.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const MODULES_DIR = (() => {
  // src/modules/aiSkills/registry.ts → src/modules
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
})();

/** Root directory that hosts every AI prompt `.md` file. Centralized in
 *  `src/prompts/` (organized by module + legacy subfolder) rather than
 *  scattered across every feature module. */
const PROMPTS_DIR = resolve(MODULES_DIR, '..', 'prompts');

export interface SkillDefinition {
  /** Stable id used in code and DB. Never rename once deployed. */
  slug: string;
  /** Human label shown in the admin UI. */
  name: string;
  /** One-line summary shown in the admin list. */
  description: string;
  /** Where and when it runs — helps admins understand the impact of an edit. */
  usage: {
    /** Which module owns it. */
    module: 'suivitess' | 'delivery' | 'mon-cv';
    /** Backend endpoint that invokes it. */
    endpoint: string;
    /** User action that triggers it. */
    trigger: string;
  };
  /** Absolute path to the default markdown file. */
  defaultFilePath: string;
}

export const SKILLS: readonly SkillDefinition[] = [
  {
    slug: 'suivitess-route-source-to-review',
    name: 'SuiviTess — Router une source (LEGACY — plus appelé)',
    description:
      'LEGACY — skill monolithique remplacé par le pipeline 3-tiers (extract → place-in-reviews → write). Conservé pour la navigation historique dans /ai-logs. N\'est plus invoqué depuis avril 2026.',
    usage: {
      module: 'suivitess',
      endpoint: 'Aucun — legacy',
      trigger: 'Aucun — remplacé par le pipeline',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/legacy/route-source-to-review.md'),
  },
  {
    slug: 'suivitess-import-source-into-document',
    name: 'SuiviTess — Intégrer une source (LEGACY — plus appelé)',
    description:
      'LEGACY — skill monolithique remplacé par le pipeline 3-tiers (extract → place → write). Conservé dans le registre uniquement pour la navigation historique dans /ai-logs. N\'est plus invoqué à aucun endroit du code depuis avril 2026.',
    usage: {
      module: 'suivitess',
      endpoint: 'Aucun — legacy',
      trigger: 'Aucun — remplacé par suivitess-extract-* / place-* / append-situation / compose-situation',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/legacy/import-source-into-document.md'),
  },
  {
    slug: 'suivitess-reformulate-subject',
    name: 'SuiviTess — Reformuler un sujet',
    description:
      'Reformule le titre et la situation d\'un sujet pour plus de clarté, sans rien supprimer ni changer le sens.',
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess/api/subjects/:id/reformulate',
      trigger: 'Bouton « Reformuler avec l\'IA » sur un sujet',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/reformulate-subject.md'),
  },
  {
    slug: 'suivitess-synthesize-situation',
    name: 'SuiviTess — Synthétiser une situation',
    description:
      'Nettoie et synthétise la situation d\'un sujet : supprime les en-têtes de date legacy, déduplique les lignes, barre les points clos, condense les passages verbeux, et ajoute un bloc « Prochaines étapes ». Remplace intégralement la situation existante.',
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess-api/subjects/:id/synthesize-situation',
      trigger: 'Bouton « Synthétiser » sur un sujet',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/synthesize-situation.md'),
  },
  {
    slug: 'delivery-reorganize-board',
    name: 'Delivery — Réorganiser un board (LEGACY — plus appelé)',
    description:
      'LEGACY — ancien skill monolithique remplacé par le pipeline modulaire (assess-tickets → layout engine TS → write-reasoning). Conservé dans le registre pour la navigation historique dans /ai-logs. N\'est plus invoqué depuis avril 2026.',
    usage: {
      module: 'delivery',
      endpoint: 'Aucun — legacy',
      trigger: 'Aucun — remplacé par le pipeline delivery',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'delivery/legacy/reorganize-board.md'),
  },
  {
    slug: 'delivery-assess-tickets',
    name: 'Delivery — Pipeline/T1 : évaluer la qualité des tickets',
    description:
      'Tier 1 du pipeline delivery. Produit des flags qualité (hasEstimation, hasMeaningfulDescription, ready) + risk notes optionnelles par ticket. Aucun placement — juste une évaluation du contenu pour alimenter le layout engine.',
    usage: {
      module: 'delivery',
      endpoint: 'Interne — analyzeSanityCheckPipeline() dans delivery/reorganizeBoardPipeline.ts',
      trigger: 'Bouton « Vérifier avec l\'IA » sur un delivery board — tier 1 du pipeline',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'delivery/assess-tickets.md'),
  },
  {
    slug: 'delivery-write-reasoning',
    name: 'Delivery — Pipeline/T2 : rédiger les justifications de placement',
    description:
      'Tier 2 du pipeline delivery. Prend le plan décidé par le layout engine (pure TS) et produit une phrase de justification ≤ 200 chars par ticket, citant statut + version + qualité + raison du déplacement.',
    usage: {
      module: 'delivery',
      endpoint: 'Interne — analyzeSanityCheckPipeline()',
      trigger: 'Bouton « Vérifier avec l\'IA » sur un delivery board — tier 2 du pipeline',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'delivery/write-reasoning.md'),
  },
  {
    slug: 'llm-judge-faithfulness',
    name: 'Juge IA — Fidélité de l\'output',
    description:
      'Scorer llm-judge : évalue la fidélité factuelle d\'un output IA par rapport à son input source. Utilisé automatiquement dans le scoring des logs.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — invoqué par POST /ai-skills/api/logs/:id/rescore',
      trigger: 'Auto-scoring des logs ou clic admin « Relancer scorers »',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'judge/llm-judge-faithfulness.md'),
  },

  // ── Pipeline modulaire (ACTIF par défaut — seul path runtime) ────────
  //
  // Architecture 3 tiers qui a remplacé les monolithes
  // `suivitess-import-source-into-document` et `suivitess-route-source-to-
  // review` (maintenant marqués LEGACY) :
  //   Tier 1 (adapters) : extract-transcript / extract-slack / extract-outlook
  //   Tier 2 (placement) : place-in-document / place-in-reviews
  //   Tier 3 (writers)   : append-situation / compose-situation
  // Chaque skill ≤ 80 lignes, focus strict, testable en isolation dans le
  // playground et via les datasets /ai-evals.
  {
    slug: 'suivitess-extract-transcript',
    name: 'SuiviTess — Pipeline/T1 : extraire les sujets d\'une transcription',
    description:
      'Tier 1 du pipeline modulaire. Parcourt une transcription d\'appel (Fathom/Otter) et en sort des sujets atomiques avec citations brutes, sans interprétation. Matériel downstream pour les tiers placement et writer.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() dans aiSkills/analyzeSourcePipeline.ts',
      trigger: 'Analyse d\'une transcription (Fathom / Otter / enregistreur) — tier 1 du pipeline',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/extract-transcript.md'),
  },
  {
    slug: 'suivitess-extract-slack',
    name: 'SuiviTess — Pipeline/T1 : extraire les sujets d\'un fil Slack',
    description:
      'Tier 1 du pipeline modulaire. Parcourt un digest Slack (threads, mentions, réactions) et en sort des sujets atomiques avec citations brutes.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline()',
      trigger: 'Analyse d\'un digest Slack — tier 1 du pipeline',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/extract-slack.md'),
  },
  {
    slug: 'suivitess-extract-outlook',
    name: 'SuiviTess — Pipeline/T1 : extraire les sujets d\'emails Outlook/Gmail',
    description:
      'Tier 1 du pipeline modulaire. Parcourt une chaîne d\'emails et en sort des sujets atomiques avec citations brutes. Gère les quotes, signatures, CC.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline()',
      trigger: 'Analyse d\'une chaîne Outlook / Gmail — tier 1 du pipeline',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/extract-outlook.md'),
  },
  {
    slug: 'suivitess-place-in-document',
    name: 'SuiviTess — Pipeline/T2 : placer les sujets dans un suivitess ouvert',
    description:
      'Tier 2 du pipeline modulaire. Prend des sujets pré-extraits + le suivitess courant, décide pour chacun enrich/create_subject/create_section (sans rédiger le contenu).',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() (variante document-scoped)',
      trigger: 'Import dans un suivitess ouvert — tier 2 du pipeline',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/place-in-document.md'),
  },
  {
    slug: 'suivitess-place-in-reviews',
    name: 'SuiviTess — Pipeline/T2 : router les sujets vers la bonne review',
    description:
      'Tier 2 du pipeline modulaire. Prend des sujets pré-extraits + toutes les reviews, décide pour chacun la review+section cible (sans rédiger le contenu).',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() (variante multi-review)',
      trigger: 'Import en masse depuis la page listing — tier 2 du pipeline',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/place-in-reviews.md'),
  },
  {
    slug: 'suivitess-append-situation',
    name: 'SuiviTess — Pipeline/T3 : rédiger le texte à ajouter (enrich)',
    description:
      'Tier 3 du pipeline modulaire. Rédige uniquement le appendText à concaténer à une situation existante, strictement à partir des rawQuotes. Aucune invention permise.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() (par enrich, parallèle)',
      trigger: 'Décision enrich du tier 2 — rédaction du appendText',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/append-situation.md'),
  },
  {
    slug: 'suivitess-compose-situation',
    name: 'SuiviTess — Pipeline/T3 : rédiger la situation d\'un nouveau sujet',
    description:
      'Tier 3 du pipeline modulaire. Rédige une situation initiale pour un create_subject/new-subject, strictement à partir des rawQuotes.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() (par création, parallèle)',
      trigger: 'Décision create du tier 2 — rédaction de la situation initiale',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/compose-situation.md'),
  },
  {
    slug: 'suivitess-suggest-name',
    name: 'SuiviTess — Proposer un nom de review / section / sujet',
    description:
      "Utilitaire appelé à la demande depuis la modale d'import bulk : propose un nom adapté quand l'utilisateur crée une nouvelle review, section ou sujet. Prend le contexte source (rawQuotes, entities, parents) et renvoie un nom court. Supporte aussi la re-génération avec une suggestion précédente comme input.",
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess/api/transcription/suggest-name',
      trigger: "Bouton « 🤖 Proposer avec l'IA » dans l'éditeur de nom du wizard d'import bulk",
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/suggest-name.md'),
  },
  {
    slug: 'suivitess-cross-source-consolidate',
    name: 'SuiviTess — Consolider l\'inbox multi-sources',
    description:
      'Skill transverse appelé à la demande depuis la boîte de réception. Prend N lignes inbox `pending` (chacune avec ses propositions pré-routées) et produit une vue dédupliquée et thématiquement fusionnée — un seul sujet consolidé par thème métier au lieu de 4 cartes redondantes. Conserve les routings d\'origine, ne re-route pas.',
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess/api/inbox/consolidate-pending',
      trigger: 'Bouton « Consolider » dans la barre de filtres de la page inbox',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/cross-source-consolidate.md'),
  },
  {
    slug: 'suivitess-detect-cross-doc-duplicates',
    name: 'SuiviTess — Détecter les doublons cross-documents',
    description:
      "Skill transverse appelé à la demande depuis la liste suivitess. Prend tous les sujets visibles par l'utilisateur (déjà aplatis avec leur document/section d'origine) et produit des groupes de 2 à 5 sujets issus de documents DISTINCTS qui convergent vers le même thème métier. L'utilisateur choisit un parent canonique par groupe et le backend matérialise les liens via `suivitess_subject_cross_links`. Ne regroupe jamais des sujets du même document.",
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess-api/detect-cross-doc-duplicates',
      trigger: "Bouton « Détecter les doublons » du menu Actions de la liste suivitess",
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/detect-cross-doc-duplicates.md'),
  },
  {
    slug: 'suivitess-reconcile-multi-source',
    name: 'SuiviTess — Pipeline/T1.5 : réconcilier plusieurs sources',
    description:
      'Tier 1.5 du pipeline modulaire. Prend N extractions individuelles (transcriptions / Slack / Outlook) datées et produit une liste consolidée avec détection des chevauchements, complements et contradictions chronologiques. Invoqué uniquement si ≥2 sources sont sélectionnées en même temps.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeMultiSourceForReviews() dans aiSkills/analyzeSourcePipeline.ts',
      trigger: 'Bouton « Analyser » de l\'import multi-source — après T1, avant T2',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'suivitess/reconcile-multi-source.md'),
  },
  {
    slug: 'mon-cv-adapt-atomic-classic',
    name: 'Mon-CV — Adapter un sujet (mode CLASSIQUE)',
    description:
      'Tier 2 — adaptation tuile-par-tuile, MODE STRICT. Réécrit chaque sujet atomique de manière minimale et fidèle au CV original (synonymes ATS uniquement, aucune invention). N\'ajoute jamais de nouvelle compétence. Choisi par l\'utilisateur dans la modale via le sélecteur de mode.',
    usage: {
      module: 'mon-cv',
      endpoint: 'POST /mon-cv-api/tile-adaptations/:id/run-adapt + regenerate (mode=classic)',
      trigger: 'Sélection « Mode classique » dans la modale d\'adaptation',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'mon-cv/adapt-atomic-classic.md'),
  },
  {
    slug: 'mon-cv-answer-question',
    name: 'Mon-CV — Répondre à une question (Q&A adaptation)',
    description:
      'Tier 2 — répond à une question (ouverte ou ciblée) en s\'appuyant sur le CV adapté à l\'offre. 1ère personne, faits du CV uniquement, croisé avec les attentes de l\'offre. Utilisé par la section « Questions / Réponses » de la page d\'une adaptation — chaque clic « Générer la réponse » lance ce skill avec la question courante.',
    usage: {
      module: 'mon-cv',
      endpoint: 'POST /mon-cv-api/adaptations/:id/questions/:qid/answer',
      trigger: 'Bouton « Générer la réponse » / « Régénérer » sur une question custom de la page d\'adaptation',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'mon-cv/answer-question.md'),
  },
  {
    slug: 'mon-cv-translate-en',
    name: 'Mon-CV — Traduire le CV en anglais',
    description:
      'Tier 2 — transformation. Traduit l\'intégralité d\'un CV (résumé, intitulés, missions, descriptions) en anglais professionnel. Préserve les noms propres, les technos et les faits ; ne reformule pas la substance. Le résultat est sauvegardé comme un nouveau CV avec suffixe « · EN ».',
    usage: {
      module: 'mon-cv',
      endpoint: 'POST /mon-cv-api/cvs/:id/transform (kind=translate-en)',
      trigger: 'Bouton « Traduire en anglais » de la liste des CV',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'mon-cv/translate-en.md'),
  },
  {
    slug: 'mon-cv-esn-version',
    name: 'Mon-CV — Convertir en version ESN',
    description:
      'Tier 2 — transformation. Réécrit un CV au format standard des ESN (Entreprise de Services du Numérique) : anonymisation par initiales, résumé étoffé à la 3ᵉ personne, expériences structurées contexte/missions/environnement technique. Le résultat est sauvegardé comme un nouveau CV avec suffixe « · ESN ».',
    usage: {
      module: 'mon-cv',
      endpoint: 'POST /mon-cv-api/cvs/:id/transform (kind=esn)',
      trigger: 'Bouton « Version ESN » de la liste des CV',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'mon-cv/esn-version.md'),
  },
  {
    slug: 'mon-cv-adapt-atomic-aggressive',
    name: 'Mon-CV — Adapter un sujet (mode AGRESSIF)',
    description:
      'Tier 2 — adaptation tuile-par-tuile, MODE AGRESSIF. Réécriture plus offensive (enrichissement par mots-clés ATS, méthodologies plausibles, vocabulaire de l\'offre) ET propose en plus des compétences à AJOUTER absentes du CV mais demandées par l\'offre. Choisi par l\'utilisateur dans la modale.',
    usage: {
      module: 'mon-cv',
      endpoint: 'POST /mon-cv-api/tile-adaptations/:id/run-adapt + regenerate (mode=aggressive)',
      trigger: 'Sélection « Mode agressif » dans la modale d\'adaptation',
    },
    defaultFilePath: resolve(PROMPTS_DIR, 'mon-cv/adapt-atomic-aggressive.md'),
  },
] as const;

export function getSkill(slug: string): SkillDefinition | undefined {
  return SKILLS.find(s => s.slug === slug);
}
