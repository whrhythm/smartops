import fs from 'node:fs';
import path from 'node:path';

import { LoggerService } from '@backstage/backend-plugin-api';
import { parse } from 'yaml';

import { LlmConfig } from './config';
import { PromptTaskType } from './promptCatalog';

const DEFAULT_MODEL_PROFILES_PATH = 'config/ai-assistant/model-profiles.yaml';

type ProfileOverride = {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  secretKey?: string;
  apiMode?: 'chat-completions' | 'responses';
  webSearchEnabled?: boolean;
  webSearchMaxKeyword?: number;
};

export type ResolvedModelProfile = {
  id: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  secretKey?: string;
  apiMode?: 'chat-completions' | 'responses';
  webSearchEnabled?: boolean;
  webSearchMaxKeyword?: number;
};

export type ModelProfileSet = {
  profiles: Record<string, ResolvedModelProfile>;
  routing: Record<PromptTaskType, string>;
};

type ModelProfilesYaml = {
  defaults?: {
    profile?: string;
  };
  profiles?: Record<string, ProfileOverride>;
  routing?: Partial<Record<PromptTaskType, string>>;
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

const resolveProfile = (
  id: string,
  base: LlmConfig,
  override: ProfileOverride | undefined,
): ResolvedModelProfile => ({
  id,
  provider: override?.provider ?? base.provider,
  baseUrl: override?.baseUrl ?? base.baseUrl,
  apiKey: override?.apiKey ?? base.apiKey,
  model: override?.model ?? base.model,
  secretKey: override?.secretKey ?? base.secretKey,
  apiMode: override?.apiMode ?? base.apiMode,
  webSearchEnabled: override?.webSearchEnabled ?? base.webSearchEnabled,
  webSearchMaxKeyword:
    override?.webSearchMaxKeyword ?? base.webSearchMaxKeyword,
});

const createDefaultModelProfiles = (base: LlmConfig): ModelProfileSet => {
  const profiles: Record<string, ResolvedModelProfile> = {
    default: resolveProfile('default', base, undefined),
  };

  const routing = TASK_KEYS.reduce((acc, task) => {
    acc[task] = 'default';
    return acc;
  }, {} as Record<PromptTaskType, string>);

  return {
    profiles,
    routing,
  };
};

export const loadModelProfiles = (
  modelProfilesPath: string | undefined,
  baseLlmConfig: LlmConfig,
  logger: LoggerService,
): ModelProfileSet => {
  const defaults = createDefaultModelProfiles(baseLlmConfig);
  const resolvedPath = resolveConfigPath(
    modelProfilesPath,
    DEFAULT_MODEL_PROFILES_PATH,
  );

  if (!fs.existsSync(resolvedPath)) {
    logger.warn(
      `Model profiles file not found at '${resolvedPath}', using default profile only`,
    );
    return defaults;
  }

  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = (parse(raw) ?? {}) as ModelProfilesYaml;

    const profiles: Record<string, ResolvedModelProfile> = {
      ...defaults.profiles,
    };

    for (const [id, override] of Object.entries(parsed.profiles ?? {})) {
      profiles[id] = resolveProfile(id, baseLlmConfig, override);
    }

    const defaultProfileId = parsed.defaults?.profile ?? 'default';
    if (!profiles[defaultProfileId]) {
      profiles[defaultProfileId] = resolveProfile(
        defaultProfileId,
        baseLlmConfig,
        undefined,
      );
    }

    const routing = { ...defaults.routing };
    for (const task of TASK_KEYS) {
      const selected = parsed.routing?.[task];
      if (!selected) {
        routing[task] = defaultProfileId;
        continue;
      }

      if (!profiles[selected]) {
        logger.warn(
          `Model profile '${selected}' for task '${task}' not found, falling back to '${defaultProfileId}'`,
        );
        routing[task] = defaultProfileId;
        continue;
      }

      routing[task] = selected;
    }

    logger.info(
      `Loaded AI model profiles from ${resolvedPath}: ${Object.keys(profiles).join(', ')}`,
    );

    return {
      profiles,
      routing,
    };
  } catch (error) {
    logger.warn(
      `Failed to load model profiles '${resolvedPath}': ${(error as Error).message}. Using default profile only.`,
    );
    return defaults;
  }
};
