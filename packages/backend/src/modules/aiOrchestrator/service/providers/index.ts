import { LoggerService } from '@backstage/backend-plugin-api';

import { OllamaProvider } from './ollamaProvider';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { LlmProviderAdapter, ProviderClientOptions } from './types';

const isOllamaProvider = (provider: string) =>
  ['ollama', 'local-ollama', 'local'].includes(provider.toLowerCase());

export const createLlmProviderAdapter = (
  options: ProviderClientOptions,
  logger: LoggerService,
): LlmProviderAdapter => {
  if (isOllamaProvider(options.provider)) {
    logger.info('AI provider adapter: ollama/local');
    return new OllamaProvider(options);
  }

  logger.info('AI provider adapter: openai-compatible');
  return new OpenAICompatibleProvider(options);
};

export * from './types';
