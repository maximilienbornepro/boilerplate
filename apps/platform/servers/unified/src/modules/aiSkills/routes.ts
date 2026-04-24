// Admin-only API to read and edit AI skills. Mounted at /ai-skills/api.

import { Router } from 'express';
import { asyncHandler } from '@boilerplate/shared/server';
import { route } from '../../gateway/index.js';
import { SKILLS, getSkill } from './registry.js';
import * as db from './dbService.js';
import { readDefaultFile } from './skillLoader.js';
import { listAnalysisLogs, getAnalysisLog, listRecentInputs } from './analysisLogsService.js';
import { ensureSkillVersion, listVersions, shortHash } from './skillVersionService.js';
import {
  listScoresForLog,
  recordHumanScore,
  deleteScore,
  runAutoScorersForLog,
  aggregateScores,
} from './scoring/scoringService.js';
import {
  createDataset,
  listDatasets,
  getDataset,
  deleteDataset,
  listItems,
  addItemFromLog,
  addItemAdHoc,
  updateItem,
  removeItem,
} from './eval/datasetService.js';
import {
  startExperiment,
  listExperimentsForDataset,
  getExperiment,
  getExperimentReport,
} from './eval/experimentService.js';
import { loadSkill } from './skillLoader.js';

// Reserved top-level namespaces that share the same Express router — these
// must never be interpreted as skill slugs by the generic `/:slug` handlers.
const RESERVED_SLUG_NAMES = new Set([
  'datasets',
  'experiments',
  'playground',
  'logs',
  'skills',
]);

export function createRoutes(): Router {
  const router = Router();
  // The entire AI Skills editor is admin-only — every endpoint needs
  // a logged-in admin. One `router.use` applies the full gateway chain
  // (rate-limit → CSRF → auth → admin guard).
  router.use(...route({ tier: 'admin' }));

  // GET /ai-skills/api — list all skills (metadata + content)
  router.get('/', asyncHandler(async (_req, res) => {
    const rows = await db.listSkills();
    const rowsBySlug = new Map(rows.map(r => [r.slug, r]));
    const result = SKILLS.map(def => {
      const row = rowsBySlug.get(def.slug);
      return {
        slug: def.slug,
        name: def.name,
        description: def.description,
        usage: def.usage,
        isCustomized: row?.is_customized ?? false,
        updatedAt: row?.updated_at ?? null,
        updatedByUserId: row?.updated_by_user_id ?? null,
        hasContent: !!row,
      };
    });
    res.json(result);
  }));

  // GET /ai-skills/api/:slug — full content for editor
  router.get('/:slug', asyncHandler(async (req, res, next) => {
    const slug = String(req.params.slug);
    if (RESERVED_SLUG_NAMES.has(slug)) { next(); return; }
    const def = getSkill(slug);
    if (!def) { res.status(404).json({ error: 'Skill inconnu' }); return; }

    const row = await db.getSkillBySlug(def.slug);
    const defaultContent = await readDefaultFile(def);

    res.json({
      slug: def.slug,
      name: def.name,
      description: def.description,
      usage: def.usage,
      content: row?.content ?? defaultContent,
      defaultContent,
      isCustomized: row?.is_customized ?? false,
      updatedAt: row?.updated_at ?? null,
      updatedByUserId: row?.updated_by_user_id ?? null,
    });
  }));

  // PUT /ai-skills/api/:slug — save edited content
  router.put('/:slug', asyncHandler(async (req, res, next) => {
    const slug = String(req.params.slug);
    if (RESERVED_SLUG_NAMES.has(slug)) { next(); return; }
    const def = getSkill(slug);
    if (!def) { res.status(404).json({ error: 'Skill inconnu' }); return; }

    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (content.trim().length === 0) {
      res.status(400).json({ error: 'Contenu vide' });
      return;
    }

    // Ensure the row exists before updating (first-time edit).
    await db.seedSkill(def.slug, def.name, def.description, content);
    const row = await db.updateSkillContent(def.slug, content, req.user!.id);
    // Snapshot this version in ai_skill_versions so future logs can link back.
    await ensureSkillVersion(def.slug, content, req.user!.id);
    res.json(row);
  }));

  // POST /ai-skills/api/:slug/reset — restore shipped default
  router.post('/:slug/reset', asyncHandler(async (req, res, next) => {
    const slug = String(req.params.slug);
    if (RESERVED_SLUG_NAMES.has(slug)) { next(); return; }
    const def = getSkill(slug);
    if (!def) { res.status(404).json({ error: 'Skill inconnu' }); return; }

    const defaultContent = await readDefaultFile(def);
    await db.seedSkill(def.slug, def.name, def.description, defaultContent);
    const row = await db.resetSkillToDefault(def.slug, defaultContent, req.user!.id);
    await ensureSkillVersion(def.slug, defaultContent, req.user!.id);
    res.json(row);
  }));

  // GET /ai-skills/api/:slug/versions — history of edits
  router.get('/:slug/versions', asyncHandler(async (req, res, next) => {
    const slug = String(req.params.slug);
    if (RESERVED_SLUG_NAMES.has(slug)) { next(); return; }
    const def = getSkill(slug);
    if (!def) { res.status(404).json({ error: 'Skill inconnu' }); return; }
    const currentRow = await db.getSkillBySlug(def.slug);
    const currentHash = currentRow ? (await import('./skillVersionService.js')).hashContent(currentRow.content) : null;
    const rows = await listVersions(def.slug);
    res.json(rows.map(r => ({
      id: r.id,
      hash: r.content_hash,
      short: shortHash(r.content_hash),
      content: r.content,
      createdAt: r.created_at,
      createdByUserId: r.created_by_user_id,
      isCurrent: r.content_hash === currentHash,
    })));
  }));

  // ========= Analysis logs (historique des appels IA) =========

  // GET /ai-skills/api/logs — paginated list
  router.get('/logs/list', asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50')) || 50, 200);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0')) || 0, 0);
    const skillSlug = req.query.skill ? String(req.query.skill) : undefined;
    const rows = await listAnalysisLogs({ limit, offset, skillSlug });
    res.json(rows);
  }));

  // GET /ai-skills/api/logs/recent-inputs?skill=<slug>&source=<kind>&limit=40
  // Distinct recent log inputs, grouped by (skill, source_title), tagged with
  // source_kind so the playground picker can badge them (🎙 transcript,
  // 💬 slack, ✉ outlook, 📧 gmail, …).
  router.get('/logs/recent-inputs', asyncHandler(async (req, res) => {
    const skillSlug = req.query.skill ? String(req.query.skill) : undefined;
    const sourceKind = req.query.source ? String(req.query.source) : undefined;
    const limit = parseInt(String(req.query.limit ?? '40')) || 40;
    const rows = await listRecentInputs({ skillSlug, sourceKind, limit });
    res.json(rows);
  }));

  // GET /ai-skills/api/logs/:id — full detail (prompt + output)
  router.get('/logs/:id', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const row = await getAnalysisLog(id);
    if (!row) { res.status(404).json({ error: 'Log introuvable' }); return; }
    res.json(row);
  }));

  // POST /ai-skills/api/logs/:id/replay
  // Re-runs the exact same prompt against the currently-configured model,
  // with an optional override of `input_content` (the admin can tweak the
  // input in the UI before replaying). The skill content is re-loaded from
  // the DB so the prompt reflects any admin edit since the original run.
  //
  // Writes a NEW log row so both the original and the replay are visible in
  // the history.
  router.post('/logs/:id/replay', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const original = await getAnalysisLog(id);
    if (!original) { res.status(404).json({ error: 'Log introuvable' }); return; }

    const overrideInput = typeof req.body?.inputContent === 'string' ? req.body.inputContent : null;
    const overridePrompt = typeof req.body?.fullPrompt === 'string' ? req.body.fullPrompt : null;

    // Build the prompt : either use the admin-provided full prompt as-is,
    // or substitute the new input into the skill template the simplest way
    // — we keep the original prompt and append the new input section when
    // only inputContent is provided, so edits stay close to the original
    // call semantics.
    const { loadSkill } = await import('./skillLoader.js');
    const skill = await loadSkill(original.skill_slug);

    const effectiveInput = overrideInput ?? original.input_content;
    const effectivePrompt = overridePrompt ?? `${skill}

---

# Contexte exécutable (replay)

## Source
- Type : ${original.source_kind ?? '—'}
- Titre : ${original.source_title ?? '—'}

## Input brut
${effectiveInput.slice(0, 30000)}

Applique les règles ci-dessus et réponds uniquement en JSON.`;

    const { getAnthropicClient, logAnthropicUsage } = await import('../connectors/aiProvider.js');
    const { client, model } = await getAnthropicClient(req.user!.id);
    const { hash: skillVersionHash } = await ensureSkillVersion(original.skill_slug, skill, null);

    const startedAt = Date.now();
    let outputText = '';
    let errorMsg: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const aiRes = await client.messages.create({
        model,
        max_tokens: 4096,
        messages: [{ role: 'user', content: effectivePrompt }],
      });
      outputText = aiRes.content
        .filter(c => c.type === 'text')
        .map(c => (c as { type: 'text'; text: string }).text)
        .join('');
      inputTokens = aiRes.usage?.input_tokens ?? 0;
      outputTokens = aiRes.usage?.output_tokens ?? 0;
      logAnthropicUsage(req.user!.id, model, aiRes.usage, `aiSkills:replay:${original.skill_slug}`);
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : 'Erreur IA';
    }

    // Try to parse the same way the original endpoints would — best effort.
    let proposals: unknown = null;
    try {
      const arr = outputText.match(/\[[\s\S]*\]/);
      const obj = outputText.match(/\{[\s\S]*\}/);
      if (arr && (!obj || arr.index! < obj.index!)) proposals = JSON.parse(arr[0]);
      else if (obj) proposals = JSON.parse(obj[0]);
    } catch { /* leave proposals null */ }

    const { logAnalysis } = await import('./analysisLogsService.js');
    const { computeCostUsd } = await import('./pricing.js');
    const newLogId = await logAnalysis({
      userId: req.user!.id,
      userEmail: req.user!.email,
      skillSlug: `${original.skill_slug}` /* replay tag is shown via source_title below */,
      sourceKind: original.source_kind,
      sourceTitle: `[replay #${id}] ${original.source_title ?? ''}`.slice(0, 500),
      documentId: original.document_id,
      inputContent: effectiveInput,
      fullPrompt: effectivePrompt,
      aiOutputRaw: outputText,
      proposals,
      durationMs: Date.now() - startedAt,
      error: errorMsg,
      skillVersionHash,
      provider: 'anthropic',
      model,
      inputTokens,
      outputTokens,
      costUsd: computeCostUsd(model, inputTokens, outputTokens),
      parentLogId: id,
    });

    res.json({
      logId: newLogId,
      output: outputText,
      proposals,
      error: errorMsg,
    });
  }));

  // ========= Scoring (Phase 2) =========

  // GET /ai-skills/api/logs/:id/scores — list scores for a log
  router.get('/logs/:id/scores', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const rows = await listScoresForLog(id);
    res.json(rows);
  }));

  // POST /ai-skills/api/logs/:id/scores — record a human score
  // body: { name: string, value: number (-1..1), rationale?: string }
  router.post('/logs/:id/scores', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const name = String(req.body?.name ?? 'thumbs');
    const valueNum = Number(req.body?.value);
    if (!Number.isFinite(valueNum)) { res.status(400).json({ error: 'value doit être un nombre' }); return; }
    const value = Math.max(-1, Math.min(1, valueNum));
    const rationale = typeof req.body?.rationale === 'string' ? req.body.rationale : null;
    const row = await recordHumanScore(id, req.user!.id, name, value, rationale);
    if (!row) { res.status(500).json({ error: 'Impossible d\'enregistrer le score' }); return; }
    res.json(row);
  }));

  // DELETE /ai-skills/api/logs/:id/scores/:scoreId — remove a human score
  router.delete('/logs/:id/scores/:scoreId', asyncHandler(async (req, res) => {
    const scoreId = parseInt(String(req.params.scoreId));
    if (!Number.isFinite(scoreId)) { res.status(400).json({ error: 'scoreId invalide' }); return; }
    const ok = await deleteScore(scoreId, req.user!.id);
    if (!ok) { res.status(404).json({ error: 'Score introuvable ou non autorisé' }); return; }
    res.json({ success: true });
  }));

  // POST /ai-skills/api/logs/:id/rescore — re-run auto scorers (idempotent)
  router.post('/logs/:id/rescore', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    await runAutoScorersForLog(id);
    const rows = await listScoresForLog(id);
    res.json(rows);
  }));

  // GET /ai-skills/api/skills/:slug/score-aggregate?sinceDays=7
  router.get('/skills/:slug/score-aggregate', asyncHandler(async (req, res) => {
    const def = getSkill(String(req.params.slug));
    if (!def) { res.status(404).json({ error: 'Skill inconnu' }); return; }
    const sinceDays = parseInt(String(req.query.sinceDays ?? '7')) || 7;
    const rows = await aggregateScores({ skillSlug: def.slug, sinceDays });
    res.json(rows);
  }));

  // ========= Datasets (Phase 3) =========

  router.get('/datasets', asyncHandler(async (req, res) => {
    const skillSlug = req.query.skill ? String(req.query.skill) : undefined;
    const rows = await listDatasets(skillSlug);
    res.json(rows);
  }));

  router.post('/datasets', asyncHandler(async (req, res) => {
    const name = String(req.body?.name ?? '').trim();
    const skillSlug = String(req.body?.skillSlug ?? '');
    const description = typeof req.body?.description === 'string' ? req.body.description : null;
    if (!name) { res.status(400).json({ error: 'name requis' }); return; }
    if (!getSkill(skillSlug)) { res.status(400).json({ error: 'skillSlug inconnu' }); return; }
    const row = await createDataset(name, skillSlug, description, req.user!.id);
    res.json(row);
  }));

  router.get('/datasets/:id', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const dataset = await getDataset(id);
    if (!dataset) { res.status(404).json({ error: 'Dataset introuvable' }); return; }
    const items = await listItems(id);
    const experiments = await listExperimentsForDataset(id);
    res.json({ dataset, items, experiments });
  }));

  router.delete('/datasets/:id', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    await deleteDataset(id);
    res.json({ success: true });
  }));

  // POST /datasets/:id/items — either fromLog or ad-hoc
  router.post('/datasets/:id/items', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const { logId, inputContent, expectedOutput, notes } = req.body as {
      logId?: number; inputContent?: string; expectedOutput?: unknown; notes?: string | null;
    };
    if (logId != null) {
      const row = await addItemFromLog(id, logId, expectedOutput, notes ?? null);
      if (!row) { res.status(404).json({ error: 'Log introuvable' }); return; }
      res.json(row);
    } else if (typeof inputContent === 'string' && inputContent.length > 0) {
      const row = await addItemAdHoc(id, inputContent, expectedOutput, notes ?? null);
      res.json(row);
    } else {
      res.status(400).json({ error: 'Fournir logId ou inputContent' });
    }
  }));

  router.put('/datasets/:id/items/:itemId', asyncHandler(async (req, res) => {
    const itemId = parseInt(String(req.params.itemId));
    if (!Number.isFinite(itemId)) { res.status(400).json({ error: 'itemId invalide' }); return; }
    const { inputContent, expectedOutput, notes } = req.body as {
      inputContent?: string; expectedOutput?: unknown; notes?: string | null;
    };
    const row = await updateItem(itemId, {
      input_content: inputContent,
      expected_output: expectedOutput,
      expected_notes: notes,
    });
    if (!row) { res.status(404).json({ error: 'Item introuvable' }); return; }
    res.json(row);
  }));

  router.delete('/datasets/:id/items/:itemId', asyncHandler(async (req, res) => {
    const itemId = parseInt(String(req.params.itemId));
    if (!Number.isFinite(itemId)) { res.status(400).json({ error: 'itemId invalide' }); return; }
    await removeItem(itemId);
    res.json({ success: true });
  }));

  // ========= Experiments (Phase 3) =========

  // POST /experiments — launch an async run of a skill version on a dataset.
  // body: { datasetId, name, skillContent? (defaults to current skill) }
  router.post('/experiments', asyncHandler(async (req, res) => {
    const datasetId = parseInt(String(req.body?.datasetId));
    if (!Number.isFinite(datasetId)) { res.status(400).json({ error: 'datasetId invalide' }); return; }
    const dataset = await getDataset(datasetId);
    if (!dataset) { res.status(404).json({ error: 'Dataset introuvable' }); return; }

    const name = String(req.body?.name ?? `run-${new Date().toISOString().slice(0, 16)}`).slice(0, 200);
    const skillContent = typeof req.body?.skillContent === 'string' && req.body.skillContent.trim().length > 0
      ? req.body.skillContent
      : await loadSkill(dataset.skill_slug);

    // Caller can override the prompt builder via `promptTemplate` containing
    // placeholders {{skill}} and {{input}}. Default builder just concats.
    const promptTemplate = typeof req.body?.promptTemplate === 'string' ? req.body.promptTemplate : null;
    const buildPrompt = (skill: string, input: string) => {
      if (promptTemplate) {
        return promptTemplate.replace('{{skill}}', skill).replace('{{input}}', input);
      }
      return `${skill}\n\n---\n\n# Input\n${input}\n\nApplique les règles et réponds uniquement en JSON.`;
    };

    const exp = await startExperiment({
      datasetId,
      name,
      skillContent,
      userId: req.user!.id,
      userEmail: req.user!.email,
      buildPrompt,
    });
    res.json(exp);
  }));

  router.get('/experiments/:id', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const report = await getExperimentReport(id);
    if (!report) { res.status(404).json({ error: 'Experiment introuvable' }); return; }
    res.json(report);
  }));

  router.get('/experiments/:id/status', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id));
    if (!Number.isFinite(id)) { res.status(400).json({ error: 'id invalide' }); return; }
    const exp = await getExperiment(id);
    if (!exp) { res.status(404).json({ error: 'Experiment introuvable' }); return; }
    res.json(exp);
  }));

  // ========= Playground (Phase 4) =========

  // POST /ai-skills/api/playground/run
  // body: { skillSlug, variants: [{label, content}], inputs: [{label?, content}] }
  router.post('/playground/run', asyncHandler(async (req, res) => {
    const skillSlug = String(req.body?.skillSlug ?? '');
    if (!getSkill(skillSlug)) { res.status(400).json({ error: 'skillSlug inconnu' }); return; }

    const variants = Array.isArray(req.body?.variants) ? req.body.variants : [];
    const inputs = Array.isArray(req.body?.inputs) ? req.body.inputs : [];
    if (variants.length === 0 || inputs.length === 0) {
      res.status(400).json({ error: 'Fournir au moins 1 variant et 1 input' });
      return;
    }
    if (variants.length * inputs.length > 40) {
      res.status(400).json({ error: 'Matrice trop grande (max 40 cellules)' });
      return;
    }

    const { runPlayground } = await import('./playground/playgroundService.js');
    const result = await runPlayground({
      skillSlug,
      variants: variants.map((v: { label: string; content: string }) => ({
        label: String(v.label ?? '').slice(0, 80) || 'variant',
        content: String(v.content ?? ''),
      })),
      inputs: inputs.map((i: { label?: string; content: string }) => ({
        label: i.label ? String(i.label).slice(0, 80) : undefined,
        content: String(i.content ?? ''),
      })),
      userId: req.user!.id,
      userEmail: req.user!.email,
    });
    res.json(result);
  }));

  return router;
}
