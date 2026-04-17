// Admin-only API to read and edit AI skills. Mounted at /ai-skills/api.

import { Router } from 'express';
import { asyncHandler } from '@boilerplate/shared/server';
import { authMiddleware, adminMiddleware } from '../../middleware/index.js';
import { SKILLS, getSkill } from './registry.js';
import * as db from './dbService.js';
import { readDefaultFile } from './skillLoader.js';
import { listAnalysisLogs, getAnalysisLog } from './analysisLogsService.js';

export function createRoutes(): Router {
  const router = Router();
  router.use(authMiddleware);
  router.use(adminMiddleware);

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
  router.get('/:slug', asyncHandler(async (req, res) => {
    const def = getSkill(String(req.params.slug));
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
  router.put('/:slug', asyncHandler(async (req, res) => {
    const def = getSkill(String(req.params.slug));
    if (!def) { res.status(404).json({ error: 'Skill inconnu' }); return; }

    const content = typeof req.body?.content === 'string' ? req.body.content : '';
    if (content.trim().length === 0) {
      res.status(400).json({ error: 'Contenu vide' });
      return;
    }

    // Ensure the row exists before updating (first-time edit).
    await db.seedSkill(def.slug, def.name, def.description, content);
    const row = await db.updateSkillContent(def.slug, content, req.user!.id);
    res.json(row);
  }));

  // POST /ai-skills/api/:slug/reset — restore shipped default
  router.post('/:slug/reset', asyncHandler(async (req, res) => {
    const def = getSkill(String(req.params.slug));
    if (!def) { res.status(404).json({ error: 'Skill inconnu' }); return; }

    const defaultContent = await readDefaultFile(def);
    await db.seedSkill(def.slug, def.name, def.description, defaultContent);
    const row = await db.resetSkillToDefault(def.slug, defaultContent, req.user!.id);
    res.json(row);
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

    const { getAnthropicClient } = await import('../connectors/aiProvider.js');
    const { client, model } = await getAnthropicClient(req.user!.id);

    const startedAt = Date.now();
    let outputText = '';
    let errorMsg: string | null = null;
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
    });

    res.json({
      logId: newLogId,
      output: outputText,
      proposals,
      error: errorMsg,
    });
  }));

  return router;
}
