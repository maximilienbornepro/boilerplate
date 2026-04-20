// In-memory tracker for pipeline job progress. Used by the async variants
// of the suivitess analyze endpoints : the handler creates a job, fires
// the pipeline in background with progress callbacks that update the
// job state, and returns a jobId immediately. The frontend polls
// GET /suivitess/api/pipeline-jobs/:id every ~500 ms to drive the real
// progress indicator (no more fake timers).
//
// Why in-memory : we don't need persistence — jobs are short-lived
// (< 30 s), only one server instance reads/writes, and losing progress
// on restart is acceptable (the user just re-runs). If we later scale
// horizontally, swap for Redis or Postgres.

import { randomUUID } from 'node:crypto';

export type PipelinePhase =
  | 'queued'
  | 'tier1'           // extracting subjects
  | 'tier2'           // deciding placements
  | 'tier3'           // writing (parallel)
  | 'done'
  | 'error';

export interface PipelineJob {
  id: string;
  phase: PipelinePhase;
  /** Subjects produced by T1 (set when T1 ends). */
  subjectsExtracted: number;
  /** Placements produced by T2 (set when T2 ends). */
  placementsProduced: number;
  /** How many T3 writers are in flight (set at T3 start, decremented as
   *  each writer finishes). Lets the UI show "3/5 writers done". */
  t3Total: number;
  t3Done: number;
  /** Per-tier duration in ms, filled as each tier completes. */
  durations: { t1?: number; t2?: number; t3?: number };
  rootLogId: number | null;
  /** Final result — only set when phase === 'done'. Shape depends on
   *  the endpoint (document variant vs reviews variant) ; the route
   *  handler casts it appropriately. */
  result: unknown | null;
  error: string | null;
  createdAt: number;   // epoch ms
  updatedAt: number;
}

export interface PipelineProgressEvent {
  kind: 't1-start' | 't1-end' | 't2-start' | 't2-end' | 't3-start' | 't3-writer-done' | 't3-end' | 'error';
  subjectsExtracted?: number;
  placementsProduced?: number;
  t3Total?: number;
  rootLogId?: number | null;
  durationMs?: number;
  error?: string;
}

const jobs = new Map<string, PipelineJob>();

/** Clean up jobs older than 15 min so the map doesn't grow forever.
 *  Called opportunistically on each new job creation. */
function gc(): void {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [id, j] of jobs.entries()) {
    if (j.updatedAt < cutoff) jobs.delete(id);
  }
}

export function createJob(): PipelineJob {
  gc();
  const now = Date.now();
  const job: PipelineJob = {
    id: randomUUID(),
    phase: 'queued',
    subjectsExtracted: 0,
    placementsProduced: 0,
    t3Total: 0,
    t3Done: 0,
    durations: {},
    rootLogId: null,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): PipelineJob | null {
  return jobs.get(id) ?? null;
}

/** Build a typed callback ready to pass to analyzeSourceForXxx. */
export function makeOnProgress(jobId: string): (e: PipelineProgressEvent) => void {
  return (e) => {
    const j = jobs.get(jobId);
    if (!j) return;
    j.updatedAt = Date.now();
    switch (e.kind) {
      case 't1-start':
        j.phase = 'tier1';
        break;
      case 't1-end':
        j.subjectsExtracted = e.subjectsExtracted ?? j.subjectsExtracted;
        j.rootLogId = e.rootLogId ?? j.rootLogId;
        if (e.durationMs != null) j.durations.t1 = e.durationMs;
        break;
      case 't2-start':
        j.phase = 'tier2';
        break;
      case 't2-end':
        j.placementsProduced = e.placementsProduced ?? j.placementsProduced;
        if (e.durationMs != null) j.durations.t2 = e.durationMs;
        break;
      case 't3-start':
        j.phase = 'tier3';
        j.t3Total = e.t3Total ?? 0;
        j.t3Done = 0;
        break;
      case 't3-writer-done':
        j.t3Done += 1;
        break;
      case 't3-end':
        if (e.durationMs != null) j.durations.t3 = e.durationMs;
        break;
      case 'error':
        j.phase = 'error';
        j.error = e.error ?? 'unknown';
        break;
    }
  };
}

/** Called by the route handler when the pipeline returns, to flip the job
 *  to 'done' and attach the result. */
export function finishJob(id: string, result: unknown): void {
  const j = jobs.get(id);
  if (!j) return;
  j.phase = 'done';
  j.result = result;
  j.updatedAt = Date.now();
}

export function failJob(id: string, error: string): void {
  const j = jobs.get(id);
  if (!j) return;
  j.phase = 'error';
  j.error = error;
  j.updatedAt = Date.now();
}
