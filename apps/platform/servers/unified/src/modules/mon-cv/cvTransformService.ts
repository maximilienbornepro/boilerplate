// CV-level transformations : translate to English, ESN format.
//
// Both are Tier-2 single-shot AI calls : input = the full CVData
// JSON, output = a new CVData JSON. The result is saved as a brand
// new CV row (it never overwrites the source) so the user can keep
// editing both versions side-by-side.

import { runSkill } from '../aiSkills/runSkill.js';
import type { CVData } from './types.js';

export type TransformKind = 'translate-en' | 'esn';

/** Compute initials from a person's full name for the ESN
 *  anonymisation (e.g. "Maximilien Borne" → "MB"). Falls back to
 *  the first 2 letters of the name when there's only a first name,
 *  or "XX" when the field is empty. */
export function computeInitials(fullName: string | undefined | null): string {
  const cleaned = (fullName ?? '').trim();
  if (cleaned.length === 0) return 'XX';
  const parts = cleaned.split(/\s+/).filter(p => p.length > 0);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  // Single token : take first two letters
  return cleaned.slice(0, 2).toUpperCase();
}

export async function transformCV(
  cvData: CVData,
  kind: TransformKind,
  userId: number,
  userEmail: string | null = null,
): Promise<{ transformed: CVData; logId: number | null }> {
  const slug =
    kind === 'translate-en'
      ? 'mon-cv-translate-en'
      : 'mon-cv-esn-version';

  // ESN mode needs the initials for anonymisation. Computed
  // server-side and passed in the prompt context — the model uses
  // them everywhere it would normally write the candidate's name.
  const initials = kind === 'esn' ? computeInitials(cvData.name) : null;

  const payload = kind === 'esn'
    ? { cvData, initials }
    : { cvData };

  const json = JSON.stringify(payload, null, 2);
  // Generous clip — a full CV with 10+ experiences can hit ~30k
  // chars but we cap at 80k to leave headroom for the prompt itself
  // and reasonable output.
  const clipped = json.length > 80000 ? json.slice(0, 80000) : json;

  const expectedShape = kind === 'esn'
    ? `Renvoie UNIQUEMENT le JSON CVData transformé (3ᵉ personne, anonymisé par les initiales fournies). Aucun markdown, aucun préambule. Initiales à utiliser : ${initials}.`
    : 'Renvoie UNIQUEMENT le JSON CVData traduit en anglais. Aucun markdown, aucun préambule.';

  const run = await runSkill({
    slug,
    userId,
    userEmail,
    buildContext: () => `## Contexte (transformation = ${kind})\n\n\`\`\`json\n${clipped}\n\`\`\`\n\n${expectedShape}`,
    inputContent: clipped,
    sourceKind: 'cv',
    sourceTitle: kind === 'translate-en' ? 'Traduction en anglais' : 'Version ESN',
    // Output is a full CVData JSON which can be ~30k chars in
    // dense cases. 16k tokens (~ 60k chars) is the safe ceiling.
    maxTokens: 16000,
  });

  const transformed = parseJsonObject<CVData>(run.outputText);
  if (!transformed) {
    throw new Error(
      `[mon-cv transform ${kind}] Skill returned unparseable JSON (logId=${run.logId}). Raw (first 1k):\n${run.outputText.slice(0, 1000)}`
    );
  }
  return { transformed, logId: run.logId };
}

function parseJsonObject<T>(raw: string): T | null {
  const candidates: string[] = [];
  candidates.push(raw.trim());
  candidates.push(stripMarkdownFences(raw));
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1].trim());
  // Largest top-level {...} block fallback
  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) candidates.push(objMatch[0]);
  for (const c of candidates) {
    if (!c) continue;
    try { return JSON.parse(c) as T; } catch { /* try next */ }
  }
  return null;
}

function stripMarkdownFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('```json')) s = s.slice(7).trim();
  else if (s.startsWith('```')) s = s.slice(3).trim();
  if (s.endsWith('```')) s = s.slice(0, -3).trim();
  return s;
}
