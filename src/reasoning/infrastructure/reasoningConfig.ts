import { existsSync, readFileSync } from 'node:fs';

export interface ReasoningConfig {
  model: string;
  systemPrompt: string;
}

const DEFAULT_CONFIG_PATH = 'config/reasoning.json';

/**
 * Loads the system prompt + model pair from an external JSON file, so they
 * can be tuned without a code change (see conversation-reasoning spec -
 * "Externally configurable reasoning behavior"). Fails fast with a clear
 * error instead of letting the app boot with an unusable reasoning setup.
 */
export function loadReasoningConfig(filePath: string = process.env.REASONING_CONFIG_PATH ?? DEFAULT_CONFIG_PATH): ReasoningConfig {
  if (!existsSync(filePath)) {
    throw new Error(
      `Reasoning config file not found at "${filePath}". Create it with { "model": "...", "systemPrompt": "..." }.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error(`Reasoning config file at "${filePath}" is not valid JSON: ${(error as Error).message}`);
  }

  const { model, systemPrompt } = (parsed ?? {}) as Partial<ReasoningConfig>;
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new Error(`Reasoning config file at "${filePath}" is missing a non-empty "model" string.`);
  }
  if (typeof systemPrompt !== 'string' || systemPrompt.trim().length === 0) {
    throw new Error(`Reasoning config file at "${filePath}" is missing a non-empty "systemPrompt" string.`);
  }

  return { model, systemPrompt };
}
