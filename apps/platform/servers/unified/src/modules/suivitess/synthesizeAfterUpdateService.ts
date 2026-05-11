// Post-update synthesis : after a subject has been updated by the
// import pipeline (manual /transcription/apply-routing OR scheduler
// applySubjectUpdates), run the `suivitess-synthesize-situation` skill
// on the resulting situation so :
//   - old "Mise à jour automatique en date du …" legacy lines are dropped
//   - duplicates are collapsed
//   - closed points are wrapped in `~~…~~`
//   - a `Prochaines étapes :` block is refreshed
//
// Scope : ONLY subjects that were actually updated. New subjects are
// left alone (they start with a fresh AI-written situation, nothing
// to clean). Fail-soft : a synth failure never blocks the import.
//
// Latency : the synth is fire-and-forget via setImmediate so the
// import response is not delayed. The synthesized version lands in
// the DB seconds later ; the next read picks it up.

import * as db from './dbService.js';

/** Run `suivitess-synthesize-situation` synchronously on a single
 *  subject and write the result back. Pure helper — caller decides
 *  scheduling (sync vs. fire-and-forget). Returns true when the
 *  situation was effectively rewritten, false on any soft failure
 *  (empty situation, bad AI output, runSkill throws). */
export async function synthesizeSubjectInPlace(
  subjectId: string,
  userId: number,
  userEmail: string | null,
): Promise<boolean> {
  try {
    const existing = await db.getSubject(subjectId);
    if (!existing) return false;
    const currentSituation = (existing.situation || '').trim();
    // Empty situation : nothing to synthesize.
    if (!currentSituation) return false;

    const inputPayload = {
      subjectTitle: existing.title,
      currentSituation: existing.situation,
    };
    const inputSummary = JSON.stringify(inputPayload, null, 2);

    const { runSkill } = await import('../aiSkills/runSkill.js');
    const runRes = await runSkill({
      slug: 'suivitess-synthesize-situation',
      userId,
      userEmail,
      // sourceKind is purposely distinct from the regular subject
      // synth so /ai-logs can filter the auto-synth triggered after
      // an import apart from the manual button trigger.
      sourceKind: 'subject-auto-synth',
      sourceTitle: existing.title,
      documentId: null,
      inputContent: inputSummary,
      buildPrompt: (skill) =>
        `${skill}\n\n---\n\n# Sujet à synthétiser\n\n${inputSummary}\n\nApplique les règles ci-dessus et réponds uniquement en JSON.`,
      maxTokens: 4096,
    });

    let json = runRes.outputText.trim();
    if (json.startsWith('```json')) json = json.slice(7);
    if (json.startsWith('```')) json = json.slice(3);
    if (json.endsWith('```')) json = json.slice(0, -3);
    let result: { situation?: unknown } = {};
    try {
      result = JSON.parse(json.trim());
    } catch {
      const match = runRes.outputText.match(/\{[\s\S]*\}/);
      if (match) {
        try { result = JSON.parse(match[0]); } catch { /* fall through */ }
      }
    }

    const newSituation = typeof result.situation === 'string' ? result.situation : null;
    if (!newSituation || newSituation.trim().length === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[synth-after-update] empty / unparseable AI output for subject ${subjectId} (logId=${runRes.logId ?? 'none'})`,
      );
      return false;
    }

    await db.updateSubjectFields(subjectId, ['situation = $1'], [newSituation]);
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[synth-after-update] failed for subject ${subjectId}: ${(err as Error).message}`,
    );
    return false;
  }
}

/** Fire-and-forget batch : schedule a synth pass on every subject id
 *  in `ids`. The caller's response is not awaited on these — they run
 *  in the background and silently no-op on failure. Use this after a
 *  cluster of `db.updateSubjectFields` writes triggered by an import
 *  (manual or scheduler). */
export function scheduleSynthForSubjects(
  ids: Iterable<string>,
  userId: number,
  userEmail: string | null,
): void {
  const uniq = new Set<string>(ids);
  if (uniq.size === 0) return;
  // setImmediate so the caller's request can return ASAP. We run
  // serially through the set to keep Anthropic rate gentle ; for the
  // typical 1-5 subjects per import this finishes in 5-25 s.
  setImmediate(async () => {
    for (const id of uniq) {
      await synthesizeSubjectInPlace(id, userId, userEmail);
    }
  });
}
