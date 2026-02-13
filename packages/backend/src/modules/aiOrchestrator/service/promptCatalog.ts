import fs from 'node:fs';
import path from 'node:path';

import { LoggerService } from '@backstage/backend-plugin-api';
import { parse } from 'yaml';

export type PromptTaskType =
  | 'health_check'
  | 'action_plan'
  | 'assistant_reply'
  | 'agent_intent'
  | 'agent_execution_reply';

export type PromptCatalog = Record<PromptTaskType, string>;

const DEFAULT_PROMPT_CATALOG_PATH = 'config/ai-assistant/prompts.yaml';

const DEFAULT_PROMPTS: PromptCatalog = {
  health_check:
    'You are a health check responder. Reply with exactly: OK. Do not add extra words.',
  action_plan:
    'You are an ops assistant. Return only JSON with keys: domain (k8s|vm|unknown), requiresApproval (boolean), reason (string). Set requiresApproval=true for scaling, deletion, or production changes.',
  assistant_reply:
    'You are an ops assistant. Reply in concise Chinese. Use the provided context when relevant. If approval is required, explain that approval is needed. If executionResult exists, summarize it.',
  agent_intent:
    'You are a strict orchestration planner. Return only JSON with keys: agentId, actionId, reason, input. Select only from provided actions. If no action should be executed, return {"agentId":"","actionId":"","reason":"no-op","input":{}}.',
  agent_execution_reply:
    'You are an enterprise SmartOps assistant. Reply in concise Chinese. If no action is chosen, propose one next best step. If approval is needed, clearly ask for approval.',
};

const TASK_KEYS: PromptTaskType[] = [
  'health_check',
  'action_plan',
  'assistant_reply',
  'agent_intent',
  'agent_execution_reply',
];

const resolveConfigPath = (filePath: string | undefined, fallback: string) => {
  const sourcePath = filePath && filePath.trim() ? filePath : fallback;
  if (path.isAbsolute(sourcePath)) {
    return sourcePath;
  }

  const directPath = path.resolve(process.cwd(), sourcePath);
  if (fs.existsSync(directPath)) {
    return directPath;
  }

  return path.resolve(process.cwd(), '..', '..', sourcePath);
};

type PromptCatalogYaml = {
  prompts?: Partial<Record<PromptTaskType, string>>;
};

export const loadPromptCatalog = (
  promptCatalogPath: string | undefined,
  logger: LoggerService,
): PromptCatalog => {
  const resolvedPath = resolveConfigPath(
    promptCatalogPath,
    DEFAULT_PROMPT_CATALOG_PATH,
  );

  if (!fs.existsSync(resolvedPath)) {
    logger.warn(
      `Prompt catalog not found at '${resolvedPath}', using built-in defaults`,
    );
    return DEFAULT_PROMPTS;
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = (parse(raw) ?? {}) as PromptCatalogYaml;

    const prompts: PromptCatalog = { ...DEFAULT_PROMPTS };
    for (const key of TASK_KEYS) {
      const value = parsed.prompts?.[key];
      if (typeof value === 'string' && value.trim()) {
        prompts[key] = value;
      }
    }

    logger.info(`Loaded AI prompt catalog from ${resolvedPath}`);
    return prompts;
  } catch (error) {
    logger.warn(
      `Failed to load prompt catalog '${resolvedPath}': ${(error as Error).message}. Using built-in defaults.`,
    );
    return DEFAULT_PROMPTS;
  }
};
