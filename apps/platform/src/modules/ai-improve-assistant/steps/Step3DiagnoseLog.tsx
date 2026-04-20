import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button, LoadingSpinner } from '@boilerplate/shared/components';
import { FormBlock, assistantStyles as styles, type StepProps } from '../App';
import { useAssistant } from '../AssistantContext';
import { getLogDetail, listScoresForLog, rescoreLog, voteLog, type LogDetail, type ScoreRow } from '../assistantApi';

export default function Step3DiagnoseLog({ onAdvance: _ }: StepProps) {
  const { state, dispatch } = useAssistant();
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [voting, setVoting] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreMessage, setRescoreMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Search terms — independent per pane, clicking a chip sets both.
  const [searchIn, setSearchIn] = useState('');
  const [searchOut, setSearchOut] = useState('');

  useEffect(() => {
    if (!state.logId) return;
    setLoading(true);
    Promise.all([
      getLogDetail(state.logId),
      listScoresForLog(state.logId),
    ])
      .then(([d, s]) => { setDetail(d); setScores(s); dispatch({ type: 'PATCH', patch: { logScores: s } }); })
      .catch(() => { /* best-effort */ })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.logId]);

  const submit = async (value: -1 | 1) => {
    if (!state.logId) return;
    setVoting(true);
    try {
      await voteLog(state.logId, value, note || undefined);
      const refreshed = await listScoresForLog(state.logId);
      setScores(refreshed);
      dispatch({ type: 'PATCH', patch: { humanVote: value, logScores: refreshed } });
    } finally { setVoting(false); }
  };

  const rerunScorers = async () => {
    if (!state.logId) return;
    setRescoring(true);
    setRescoreMessage(null);
    // eslint-disable-next-line no-console -- debug aid
    console.log(`[rescore] POST /ai-skills/api/logs/${state.logId}/rescore`);
    try {
      const refreshed = await rescoreLog(state.logId);
      setScores(refreshed);
      dispatch({ type: 'PATCH', patch: { logScores: refreshed } });
      // eslint-disable-next-line no-console
      console.log(`[rescore] ok — ${refreshed.length} score(s) returned`, refreshed);
      const autoCount = refreshed.filter(s => s.scorer_kind === 'heuristic' || s.scorer_kind === 'llm-judge').length;
      setRescoreMessage({
        kind: 'ok',
        text: autoCount > 0
          ? `✓ ${autoCount} scorer(s) auto recalculé(s) · total ${refreshed.length} ligne(s)`
          : `⚠ Appel OK mais 0 scorer auto retourné — le backend a peut-être silencieusement échoué. Regarde les logs serveur pour [AiSkills] runAutoScorersForLog.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error('[rescore] failed:', err);
      setRescoreMessage({ kind: 'err', text: `× ${msg}` });
    } finally { setRescoring(false); }
  };

  // ── Extract suspect entities from the llm-judge rationale (if any) ──
  // Example rationale :
  //   "L'output contient des chiffres (~40 000 erreurs P0), des noms
  //    propres non mentionnés (Grégoire Lamarque, Raphaël), dates (fin 2025)…"
  // We grab every parenthesised group and split by commas / "et" / slashes.
  const chips = useMemo<string[]>(() => {
    const judge = scores.find(s => s.scorer_kind === 'llm-judge' && s.rationale);
    if (!judge?.rationale) return [];
    return extractSuspectedEntities(judge.rationale);
  }, [scores]);

  const pickChip = (term: string) => {
    setSearchIn(term);
    setSearchOut(term);
  };

  if (!state.logId) return <p>Aucun log sélectionné — reviens à l'étape précédente.</p>;
  if (loading || !detail) return <LoadingSpinner message="Chargement du log…" />;

  return (
    <div className={styles.actionBlock}>
      {/* Chips from the llm-judge — click one to cross-search both panes. */}
      {chips.length > 0 && (
        <div style={{
          padding: 'var(--spacing-xs) var(--spacing-sm)',
          background: 'rgba(255,152,0,0.06)',
          borderLeft: '3px solid var(--warning, #ff9800)',
          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          fontSize: 'var(--font-size-xs)',
          lineHeight: 1.5,
        }}>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
            🧩 <strong>Entités suspectes</strong> extraites du rationale du llm-judge. Clique une entité
            pour la chercher dans les deux volets ci-dessous. Format : <code>terme (n in input / n in output)</code>.
            Rouge = absent de l'input mais présent dans l'output → hallucination probable.
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {chips.map(term => {
              const inCount = countOccurrences(detail.input_content, term);
              const outCount = countOccurrences(detail.ai_output_raw, term);
              const suspicious = inCount === 0 && outCount > 0;
              const verified = inCount > 0;
              const color = suspicious ? 'var(--error, #f44336)' : verified ? 'var(--success, #4caf50)' : 'var(--text-secondary)';
              return (
                <button
                  key={term}
                  type="button"
                  onClick={() => pickChip(term)}
                  style={{
                    padding: '2px 6px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    background: 'transparent',
                    color,
                    border: `1px solid ${color}`,
                    borderRadius: 2,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  title={`${inCount} in input / ${outCount} in output`}
                >
                  {term} <span style={{ opacity: 0.7 }}>({inCount}/{outCount})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Side-by-side panes. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-sm)' }}>
        <DiagnosePane
          label={`📥 Input brut (${detail.input_content.length.toLocaleString()} chars)`}
          content={detail.input_content}
          searchTerm={searchIn}
          onSearchChange={setSearchIn}
        />
        <DiagnosePane
          label={`📤 Sortie IA (${detail.ai_output_raw.length.toLocaleString()} chars)`}
          content={detail.ai_output_raw}
          searchTerm={searchOut}
          onSearchChange={setSearchOut}
        />
      </div>

      {/* Scores actuels. */}
      <FormBlock label="⭐ Scores sur ce log">
        <ScoresSection scores={scores} rescoring={rescoring} onRerun={rerunScorers} rescoreMessage={rescoreMessage} />
      </FormBlock>

      {/* Vote humain. */}
      <div className={styles.stepPourquoi} style={{ borderLeftColor: state.humanVote === 1 ? 'var(--success, #4caf50)' : state.humanVote === -1 ? 'var(--error, #f44336)' : 'var(--accent-primary)' }}>
        <div className={styles.stepPourquoiLabel}>Ton diagnostic</div>
        <p style={{ margin: '6px 0', fontSize: 'var(--font-size-sm)', lineHeight: 1.5 }}>
          Après avoir lu l'input et la sortie ci-dessus (et vérifié avec les chips + la recherche) : à ton avis, la réponse de l'IA est-elle <strong>correcte</strong> ou <strong>mauvaise</strong> ?
          <br />
          Écris en une phrase <em>ce qui ne va pas</em> (ou pourquoi c'est bon). Cette note deviendra la boussole des étapes suivantes — c'est elle qui définit ce qu'on essaie d'améliorer.
        </p>
        <input
          type="text"
          className={styles.input}
          placeholder="Ex : « n'a pas détecté que ce sujet existait déjà en section Backend », « a inventé une date de mise en prod »…"
          value={note}
          onChange={e => setNote(e.target.value)}
          disabled={voting}
        />
        <div style={{ display: 'flex', gap: 'var(--spacing-xs)', marginTop: 8 }}>
          <Button variant="secondary" onClick={() => submit(-1)} disabled={voting}>👎 Mauvaise sortie</Button>
          <Button variant="primary"   onClick={() => submit(1)}  disabled={voting}>👍 Sortie correcte</Button>
        </div>
        {state.humanVote !== null && (
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginTop: 6 }}>
            ✓ Diagnostic enregistré ({state.humanVote === 1 ? '👍 correct' : '👎 à améliorer'}). Ta note est stockée avec le log et visible dans /ai-logs — elle resservira plus tard pour mesurer si tes corrections marchent.
          </p>
        )}
      </div>
    </div>
  );
}

// ── DiagnosePane : one text panel with its own search bar + highlight ──

interface PaneProps {
  label: string;
  content: string;
  searchTerm: string;
  onSearchChange: (term: string) => void;
}

function DiagnosePane({ label, content, searchTerm, onSearchChange }: PaneProps) {
  const count = searchTerm ? countOccurrences(content, searchTerm) : 0;
  return (
    <FormBlock label={label}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
        <input
          type="text"
          className={styles.input}
          placeholder="🔍 chercher…"
          value={searchTerm}
          onChange={e => onSearchChange(e.target.value)}
          style={{ flex: 1, fontSize: 11, padding: '2px 6px' }}
        />
        {searchTerm && (
          <span style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: count > 0 ? 'var(--success, #4caf50)' : 'var(--error, #f44336)',
            alignSelf: 'center',
            minWidth: 56,
          }}>
            {count} occ.
          </span>
        )}
      </div>
      <pre className={styles.codeBlock}>
        {content ? highlight(content, searchTerm) : '(vide)'}
      </pre>
    </FormBlock>
  );
}

// ── ScoresTable : human-readable score list with labels + tooltips ────

interface ScoreMeta {
  label: string;
  kindLabel: string;
  help: string;
  /** true when the metric is "lower is better" (e.g. latency). */
  lowerIsBetter?: boolean;
}

const SCORE_META: Record<string, ScoreMeta> = {
  'heuristic:json_valid': {
    label: 'JSON valide',
    kindLabel: 'Test logique',
    help: 'Vaut 1 si la sortie IA est parseable en JSON sans erreur, 0 sinon. Sert à détecter une sortie cassée (mal fermée, commentaires…).',
  },
  'heuristic:proposal_count_sane': {
    label: 'Nb de propositions raisonnable',
    kindLabel: 'Test logique',
    help: 'Vérifie que le nombre d\'actions/sujets sorties n\'est ni 0 (skill qui n\'extrait rien) ni absurde (>50). Plage saine : 1–20.',
  },
  'heuristic:latency': {
    label: 'Latence',
    kindLabel: 'Test logique',
    help: 'Durée de l\'appel IA. Score = 1 si < 5 s, descend à 0 au-delà de ~60 s. Trop lent = problème de prompt ou de modèle.',
    lowerIsBetter: true,
  },
  'heuristic:no_error': {
    label: 'Pas d\'erreur technique',
    kindLabel: 'Test logique',
    help: '1 si l\'appel a abouti sans exception (timeout, 500, parse error…), 0 sinon.',
  },
  'llm-judge:faithfulness': {
    label: 'Fidélité à l\'input',
    kindLabel: 'Juge IA',
    help: 'Un 2ᵉ modèle IA juge si la sortie invente des informations absentes de l\'input (noms, chiffres, dates). Plus c\'est bas, plus il y a d\'hallucination probable.',
  },
  'human:thumbs': {
    label: 'Ton vote humain',
    kindLabel: 'Humain',
    help: 'Le 👍 / 👎 que tu as mis ci-dessous. 1 = correct, 0 = mauvais. Seul le dernier vote compte pour ce log.',
  },
};

function getScoreMeta(kind: string, name: string): ScoreMeta {
  const key = `${kind}:${name}`;
  return SCORE_META[key] ?? { label: name, kindLabel: kind, help: `Scorer ${kind}:${name}` };
}

interface ScoresSectionProps {
  scores: ScoreRow[];
  rescoring: boolean;
  onRerun: () => void;
  rescoreMessage?: { kind: 'ok' | 'err'; text: string } | null;
}

function ScoresSection({ scores, rescoring, onRerun, rescoreMessage }: ScoresSectionProps) {
  const hasAuto = scores.some(s => s.scorer_kind === 'heuristic' || s.scorer_kind === 'llm-judge');
  const hasAny = scores.length > 0;

  // ── Empty state : no score at all. ──
  if (!hasAny) {
    return (
      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        <p style={{ marginTop: 0 }}>
          Pas encore de score pour ce log. Les <strong>scorers automatiques</strong> (JSON valide, nb de
          propositions, latence, <em>faithfulness</em>) s'exécutent normalement en arrière-plan juste après
          l'appel IA. Si rien n'apparaît, c'est soit parce que le log est <em>ancien</em> (antérieur à la mise en
          place du scoring), soit parce que l'exécution a <em>échoué silencieusement</em>.
        </p>
        <Button variant="primary" onClick={onRerun} disabled={rescoring}>
          {rescoring ? 'Scoring en cours…' : '▶ Lancer les scorers maintenant'}
        </Button>
      </div>
    );
  }

  // ── Only human vote — prompt to compute the auto scores too. ──
  if (!hasAuto) {
    return (
      <>
        <div style={{
          padding: 'var(--spacing-xs) var(--spacing-sm)', marginBottom: 'var(--spacing-sm)',
          background: 'rgba(255,152,0,0.08)', borderLeft: '3px solid var(--warning, #ff9800)',
          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          fontSize: 'var(--font-size-sm)', lineHeight: 1.5,
        }}>
          <p style={{ margin: '0 0 6px' }}>
            ⚠ Seul ton <strong>vote humain</strong> est présent. Les <strong>scorers automatiques</strong>
            (JSON valide, nb de propositions, latence, <em>faithfulness</em>) n'ont pas tourné sur ce log
            — sans doute parce qu'il est antérieur à la mise en place du scoring. Clique pour les calculer
            maintenant, tu auras une vue complète.
          </p>
          <Button variant="primary" onClick={onRerun} disabled={rescoring}>
            {rescoring ? 'Scoring en cours…' : '▶ Calculer les scorers automatiques'}
          </Button>
        </div>
        <ScoresTable scores={scores} rescoring={rescoring} onRerun={onRerun} rescoreMessage={rescoreMessage} />
      </>
    );
  }

  // ── Normal case : heuristic + llm-judge + human. ──
  return <ScoresTable scores={scores} rescoring={rescoring} onRerun={onRerun} rescoreMessage={rescoreMessage} />;
}

function ScoresTable({ scores, rescoring, onRerun, rescoreMessage }: ScoresSectionProps) {
  // Dedupe : keep only the latest row per (kind:name) — human votes can be
  // inserted multiple times if the user changes their mind.
  const latest = useMemo(() => {
    const byKey = new Map<string, ScoreRow>();
    for (const s of scores) {
      const key = `${s.scorer_kind}:${s.score_name}`;
      const existing = byKey.get(key);
      if (!existing || new Date(s.created_at) > new Date(existing.created_at)) {
        byKey.set(key, s);
      }
    }
    // Deterministic order : heuristic, llm-judge, human.
    const order: Record<string, number> = { heuristic: 0, 'llm-judge': 1, human: 2 };
    return Array.from(byKey.values()).sort((a, b) => {
      const oa = order[a.scorer_kind] ?? 9;
      const ob = order[b.scorer_kind] ?? 9;
      if (oa !== ob) return oa - ob;
      return a.score_name.localeCompare(b.score_name);
    });
  }, [scores]);

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-sm)',
        fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)', marginBottom: 6, lineHeight: 1.5,
      }}>
        <p style={{ margin: 0, flex: 1 }}>
          Le tableau ci-dessous liste les <strong>critères</strong> évalués sur l'output de l'IA, chacun noté
          de <code>0.00</code> (mauvais) à <code>1.00</code> (parfait). Trois sources possibles :
          <strong> Test logique</strong> (vérification programmatique — JSON valide, nb de propositions…),
          <strong> Juge IA</strong> (2ᵉ modèle qui relit et note la qualité),
          <strong> Humain</strong> (ton vote 👍/👎). Passe la souris sur un critère pour voir précisément ce qu'il mesure.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {rescoreMessage && (
            <span style={{
              fontSize: 11, fontFamily: 'var(--font-mono)',
              color: rescoreMessage.kind === 'ok' ? 'var(--success, #4caf50)' : 'var(--error, #f44336)',
              maxWidth: 320,
            }}>
              {rescoreMessage.text}
            </span>
          )}
          <button
            type="button"
            onClick={onRerun}
            disabled={rescoring}
            style={{
              padding: '2px 8px', fontSize: 11, fontFamily: 'var(--font-mono)',
              background: 'transparent', color: 'var(--accent-primary)',
              border: '1px solid var(--accent-primary)', borderRadius: 2, cursor: rescoring ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
            }}
            title="Ré-exécute tous les scorers automatiques sur ce log"
          >
            {rescoring ? '🔄 En cours…' : '🔄 Re-run'}
          </button>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)', fontSize: 11 }}>
            <th style={{ textAlign: 'left',  padding: '4px 8px', fontWeight: 600 }}>Source</th>
            <th style={{ textAlign: 'left',  padding: '4px 8px', fontWeight: 600 }}>Critère</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 600, width: 70 }}>Score</th>
            <th style={{ textAlign: 'left',  padding: '4px 8px', fontWeight: 600 }}>Détail</th>
          </tr>
        </thead>
        <tbody>
          {latest.map(s => {
            const meta = getScoreMeta(s.scorer_kind, s.score_name);
            const value = parseFloat(s.score_value);
            // Color code : green ≥ 0.7, orange 0.3–0.7, red < 0.3.
            const color = value >= 0.7 ? 'var(--success, #4caf50)'
              : value >= 0.3 ? 'var(--warning, #ff9800)'
              : 'var(--error, #f44336)';
            return (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)' }} title={meta.help}>
                <td style={{ padding: '6px 8px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {meta.kindLabel}
                </td>
                <td style={{ padding: '6px 8px' }}>
                  <strong>{meta.label}</strong>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                    {s.scorer_kind}:{s.score_name}
                  </div>
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {value.toFixed(2)}
                </td>
                <td style={{ padding: '6px 8px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {s.rationale ?? <span style={{ opacity: 0.5 }}>—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Extract candidate suspect entities from a prose rationale.
 *  Heuristic : grab every parenthesised group, split by "," / ";" / " et "
 *  / "/", keep 3–60 char tokens, dedupe case-insensitive. */
function extractSuspectedEntities(rationale: string): string[] {
  const parens = rationale.match(/\(([^()]+)\)/g) || [];
  const raw: string[] = [];
  for (const p of parens) {
    const inner = p.slice(1, -1);
    const parts = inner.split(/,|;| et |\s\/\s/);
    for (const part of parts) {
      const t = part.trim().replace(/^[«»"'`]+|[«»"'`.,…]+$/g, '').trim();
      if (t.length >= 3 && t.length <= 60) raw.push(t);
    }
  }
  // Dedupe case-insensitive while preserving original casing.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of raw) {
    const key = it.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(it); }
  }
  return out.slice(0, 24);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0;
  const re = new RegExp(escapeRegExp(term), 'gi');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

/** Split `text` around occurrences of `term` (case-insensitive) and wrap
 *  matches in <mark>. Returns ReactNode[] ready to render inside <pre>. */
function highlight(text: string, term: string): ReactNode {
  if (!term) return text;
  const re = new RegExp(`(${escapeRegExp(term)})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1
      ? <mark key={i} style={{ background: 'var(--warning, #ff9800)', color: '#000', padding: '0 1px' }}>{p}</mark>
      : p,
  );
}
