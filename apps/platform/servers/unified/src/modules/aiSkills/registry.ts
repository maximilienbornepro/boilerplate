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
    module: 'suivitess' | 'delivery';
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
    name: 'SuiviTess — Router une source vers la bonne review',
    description:
      'Page listing SuiviTess : analyse une transcription / mail / Slack et décide dans QUELLE review et QUELLE section chaque sujet doit aller. Détecte les doublons avec les sujets existants.',
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess/api/transcription/analyze-and-route',
      trigger: 'Import en masse depuis la page listing (BulkTranscriptionImportModal)',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-route-source-to-review.md'),
  },
  {
    slug: 'suivitess-import-source-into-document',
    name: 'SuiviTess — Intégrer une source dans un suivitess ouvert',
    description:
      'Page d\'un suivitess : analyse une transcription / mail / Slack et propose d\'enrichir les sujets existants ou de créer de nouveaux sujets / sections dans le document courant.',
    usage: {
      module: 'suivitess',
      endpoint: 'POST /suivitess/api/documents/:docId/transcript-analyze-and-propose (et .../content-analyze-and-propose)',
      trigger: 'Assistant d\'import dans un suivitess (TranscriptionWizard — bouton « Analyser et fusionner »)',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-import-source-into-document.md'),
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
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-reformulate-subject.md'),
  },
  {
    slug: 'delivery-reorganize-board',
    name: 'Delivery — Réorganiser un board',
    description:
      'Analyse un delivery board et propose un plan de réorganisation colonne par colonne selon statut, estimation et version fix des tickets externes (Jira, ClickUp, Linear, ...).',
    usage: {
      module: 'delivery',
      endpoint: 'POST /delivery/api/boards/:id/ai-sanity-check',
      trigger: 'Bouton « Vérifier avec l\'IA » sur un delivery board',
    },
    defaultFilePath: resolve(MODULES_DIR, 'delivery/skill-reorganize-board.md'),
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
    defaultFilePath: resolve(MODULES_DIR, 'aiSkills/skill-llm-judge-faithfulness.md'),
  },

  // ── Pipeline modulaire (feature flag USE_PIPELINE_SKILLS) ─────────────
  //
  // Architecture 3 tiers qui remplace à terme le monolithique
  // `suivitess-import-source-into-document` :
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
      trigger: 'Pipeline modulaire actif (env USE_PIPELINE_SKILLS=1), source=transcript',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-extract-transcript.md'),
  },
  {
    slug: 'suivitess-extract-slack',
    name: 'SuiviTess — Pipeline/T1 : extraire les sujets d\'un fil Slack',
    description:
      'Tier 1 du pipeline modulaire. Parcourt un digest Slack (threads, mentions, réactions) et en sort des sujets atomiques avec citations brutes.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline()',
      trigger: 'Pipeline modulaire actif, source=slack',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-extract-slack.md'),
  },
  {
    slug: 'suivitess-extract-outlook',
    name: 'SuiviTess — Pipeline/T1 : extraire les sujets d\'emails Outlook/Gmail',
    description:
      'Tier 1 du pipeline modulaire. Parcourt une chaîne d\'emails et en sort des sujets atomiques avec citations brutes. Gère les quotes, signatures, CC.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline()',
      trigger: 'Pipeline modulaire actif, source=outlook/gmail',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-extract-outlook.md'),
  },
  {
    slug: 'suivitess-place-in-document',
    name: 'SuiviTess — Pipeline/T2 : placer les sujets dans un suivitess ouvert',
    description:
      'Tier 2 du pipeline modulaire. Prend des sujets pré-extraits + le suivitess courant, décide pour chacun enrich/create_subject/create_section (sans rédiger le contenu).',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() (variante document-scoped)',
      trigger: 'Pipeline modulaire actif, page d\'un suivitess',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-place-in-document.md'),
  },
  {
    slug: 'suivitess-place-in-reviews',
    name: 'SuiviTess — Pipeline/T2 : router les sujets vers la bonne review',
    description:
      'Tier 2 du pipeline modulaire. Prend des sujets pré-extraits + toutes les reviews, décide pour chacun la review+section cible (sans rédiger le contenu).',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() (variante multi-review)',
      trigger: 'Pipeline modulaire actif, page listing',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-place-in-reviews.md'),
  },
  {
    slug: 'suivitess-append-situation',
    name: 'SuiviTess — Pipeline/T3 : rédiger le texte à ajouter (enrich)',
    description:
      'Tier 3 du pipeline modulaire. Rédige uniquement le appendText à concaténer à une situation existante, strictement à partir des rawQuotes. Aucune invention permise.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() (par enrich, parallèle)',
      trigger: 'Pipeline modulaire actif, décision enrich du tier 2',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-append-situation.md'),
  },
  {
    slug: 'suivitess-compose-situation',
    name: 'SuiviTess — Pipeline/T3 : rédiger la situation d\'un nouveau sujet',
    description:
      'Tier 3 du pipeline modulaire. Rédige une situation initiale pour un create_subject/new-subject, strictement à partir des rawQuotes.',
    usage: {
      module: 'suivitess',
      endpoint: 'Interne — analyzeSourcePipeline() (par création, parallèle)',
      trigger: 'Pipeline modulaire actif, décision create du tier 2',
    },
    defaultFilePath: resolve(MODULES_DIR, 'suivitess/skill-compose-situation.md'),
  },
] as const;

export function getSkill(slug: string): SkillDefinition | undefined {
  return SKILLS.find(s => s.slug === slug);
}
