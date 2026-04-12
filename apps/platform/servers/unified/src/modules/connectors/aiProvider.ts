/**
 * Centralized AI provider configuration resolution.
 *
 * All modules that consume AI (mon-cv, rag, suivitess, roadmap) should
 * use this helper instead of directly reading process.env. The resolution
 * order is:
 *   1. User's connector config in DB (user_connectors table)
 *   2. Fallback to process.env (rétro-compatible)
 *   3. Throw if neither is available
 *
 * This allows per-user AI provider configuration via the Connectors page.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getConnector, logAIUsage } from './dbService.js';

// ── Types ─────────────────────────────────────────────────────────────

export type AIProvider = 'anthropic' | 'openai' | 'mistral' | 'scaleway';

export interface AIConfig {
  provider: AIProvider;
  apiKey: string;
  model?: string;
  baseUrl?: string;
  embeddingModel?: string;
}

// ── Default models ────────────────────────────────────────────────────

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  mistral: 'mistral-large-latest',
  scaleway: 'qwen3-32b',
};

export const DEFAULT_EMBEDDING_MODELS: Record<string, string> = {
  openai: 'text-embedding-3-small',
  scaleway: 'bge-multilingual-gemma2',
};

// ── Config resolution ─────────────────────────────────────────────────

/**
 * Resolve AI config for a user + provider.
 * Checks DB first, then falls back to process.env.
 */
export async function getAIConfig(userId: number, provider: AIProvider): Promise<AIConfig> {
  // 1. Try user connector from DB
  try {
    const connector = await getConnector(userId, provider);
    if (connector?.isActive && connector.config?.apiKey) {
      return {
        provider,
        apiKey: connector.config.apiKey as string,
        model: (connector.config.model as string) || DEFAULT_MODELS[provider],
        baseUrl: (connector.config.baseUrl as string) || undefined,
        embeddingModel: (connector.config.embeddingModel as string) || undefined,
      };
    }
  } catch {
    // DB error → fall through to env
  }

  // 2. Fallback to process.env
  const envMap: Record<AIProvider, { key: string; model?: string; baseUrl?: string; embeddingModel?: string }> = {
    anthropic: {
      key: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic,
    },
    openai: {
      key: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || DEFAULT_MODELS.openai,
      embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODELS.openai,
    },
    mistral: {
      key: process.env.MISTRAL_API_KEY || '',
      model: process.env.MISTRAL_MODEL || DEFAULT_MODELS.mistral,
    },
    scaleway: {
      key: process.env.SCALEWAY_API_KEY || '',
      model: process.env.SCALEWAY_CHAT_MODEL || DEFAULT_MODELS.scaleway,
      baseUrl: process.env.SCALEWAY_BASE_URL || '',
      embeddingModel: process.env.SCALEWAY_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODELS.scaleway,
    },
  };

  const env = envMap[provider];
  if (env.key) {
    return {
      provider,
      apiKey: env.key,
      model: env.model,
      baseUrl: env.baseUrl,
      embeddingModel: env.embeddingModel,
    };
  }

  throw new Error(`No API key found for provider "${provider}". Configure it in Connectors or set the environment variable.`);
}

// ── Client factories ──────────────────────────────────────────────────

/**
 * Log AI usage after an Anthropic messages.create call.
 * Call this with the response.usage object.
 */
export function logAnthropicUsage(
  userId: number,
  model: string,
  usage: { input_tokens?: number; output_tokens?: number },
  module?: string,
): void {
  logAIUsage(userId, 'anthropic', model, usage.input_tokens ?? 0, usage.output_tokens ?? 0, module);
}

/**
 * Log AI usage after an OpenAI chat.completions.create call.
 */
export function logOpenAIUsage(
  userId: number,
  provider: 'openai' | 'scaleway' | 'mistral',
  model: string,
  usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined,
  module?: string,
): void {
  logAIUsage(userId, provider, model, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0, module);
}

/**
 * Create an Anthropic client configured for a user.
 * Falls back to env var if user has no connector configured.
 */
export async function getAnthropicClient(userId: number): Promise<{ client: Anthropic; model: string; userId: number }> {
  const config = await getAIConfig(userId, 'anthropic');
  return {
    client: new Anthropic({ apiKey: config.apiKey }),
    model: config.model || DEFAULT_MODELS.anthropic,
    userId,
  };
}

/**
 * Create an OpenAI client configured for a user.
 * Works for both OpenAI and Scaleway (compatible API).
 */
export async function getOpenAIClient(userId: number, provider: 'openai' | 'scaleway' = 'openai'): Promise<{
  client: OpenAI;
  model: string;
  embeddingModel: string;
}> {
  const config = await getAIConfig(userId, provider);
  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    }),
    model: config.model || DEFAULT_MODELS[provider],
    embeddingModel: config.embeddingModel || DEFAULT_EMBEDDING_MODELS[provider] || 'text-embedding-3-small',
  };
}

/**
 * Create a Mistral-compatible client (uses OpenAI SDK with custom baseURL).
 */
export async function getMistralClient(userId: number): Promise<{ client: OpenAI; model: string }> {
  const config = await getAIConfig(userId, 'mistral');
  return {
    client: new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl || 'https://api.mistral.ai/v1',
    }),
    model: config.model || DEFAULT_MODELS.mistral,
  };
}

/**
 * Convenience: get the best available LLM config for a user.
 * Tries providers in order: anthropic → openai → scaleway → mistral.
 * Returns the first one that has a valid API key.
 */
export async function getAvailableLLM(userId: number): Promise<AIConfig> {
  for (const provider of ['anthropic', 'openai', 'scaleway', 'mistral'] as AIProvider[]) {
    try {
      return await getAIConfig(userId, provider);
    } catch {
      continue;
    }
  }
  throw new Error('No AI provider configured. Please configure at least one in Connectors.');
}
