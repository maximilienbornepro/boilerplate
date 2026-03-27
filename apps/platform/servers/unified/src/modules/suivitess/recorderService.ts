/**
 * recorderService.ts — manages Puppeteer agent processes for Teams call recording.
 * One agent per document at a time. Communicates via child process IPC (stdout).
 */

import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as db from './dbService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface AgentState {
  process: ChildProcess;
  recordingId: number;
  captionCount: number;
  transcript: db.CaptionEntry[];
}

// In-memory map: documentId → active agent
const activeAgents = new Map<string, AgentState>();

export async function startRecording(documentId: string, meetingUrl: string): Promise<number> {
  if (activeAgents.has(documentId)) {
    throw new Error('Un enregistrement est déjà en cours pour ce document');
  }

  const recording = await db.createRecording(documentId, meetingUrl);
  const state: AgentState = {
    process: null as any,
    recordingId: recording.id,
    captionCount: 0,
    transcript: [],
  };

  // In dev (tsx), __filename ends in .ts — run agent with tsx
  // In production (compiled), __filename ends in .js — run with node
  const isTs = __filename.endsWith('.ts');
  const agentPath = join(__dirname, isTs ? 'recorderAgent.ts' : 'recorderAgent.js');
  const runtime = isTs ? 'tsx' : 'node';

  const child = spawn(runtime, [agentPath, meetingUrl], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  state.process = child;
  activeAgents.set(documentId, state);

  // Handle stdout messages from agent
  let buffer = '';
  child.stdout?.on('data', async (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        await handleAgentMessage(documentId, msg);
      } catch { /* skip malformed */ }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    console.error(`[Recorder ${documentId}]`, chunk.toString());
  });

  child.on('exit', async () => {
    const s = activeAgents.get(documentId);
    if (s && s.recordingId === recording.id) {
      activeAgents.delete(documentId);
    }
  });

  return recording.id;
}

async function handleAgentMessage(documentId: string, msg: any) {
  const state = activeAgents.get(documentId);
  if (!state) return;

  switch (msg.type) {
    case 'status':
      await db.updateRecordingStatus(state.recordingId, msg.status, msg.error ?? null);
      break;

    case 'caption':
      state.captionCount++;
      state.transcript.push({ speaker: msg.speaker, text: msg.text, timestamp: msg.timestamp });
      // Persist count every 10 captions
      if (state.captionCount % 10 === 0) {
        await db.updateCaptionCount(state.recordingId, state.captionCount);
      }
      break;

    case 'done':
      state.transcript = msg.transcript ?? state.transcript;
      await db.saveTranscript(state.recordingId, state.transcript, state.captionCount);
      await db.updateRecordingStatus(state.recordingId, 'processing');
      // Trigger AI suggestions generation asynchronously
      generateSuggestionsAsync(documentId, state.recordingId, state.transcript).catch(console.error);
      break;

    case 'debug':
      console.log(`[Recorder ${documentId}] ${msg.message}`);
      break;
  }
}

async function generateSuggestionsAsync(documentId: string, recordingId: number, transcript: db.CaptionEntry[]) {
  try {
    const { generateSuggestions } = await import('./suggestionsService.js');
    await generateSuggestions(documentId, recordingId, transcript);
    await db.updateRecordingStatus(recordingId, 'done');
  } catch (err) {
    console.error('[Recorder] Failed to generate suggestions:', err);
    await db.updateRecordingStatus(recordingId, 'error', String(err));
  }
}

export async function stopRecording(documentId: string): Promise<void> {
  const state = activeAgents.get(documentId);
  if (!state) return;

  // Send stop signal to agent
  state.process.stdin?.write('stop\n');

  // Give it 3 seconds then kill
  await new Promise(r => setTimeout(r, 3000));
  state.process.kill('SIGTERM');
  activeAgents.delete(documentId);
}

export function getActiveRecordingStatus(documentId: string): { captionCount: number } | null {
  const state = activeAgents.get(documentId);
  if (!state) return null;
  return { captionCount: state.captionCount };
}
