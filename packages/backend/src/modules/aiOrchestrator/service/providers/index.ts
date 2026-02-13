import { LoggerService } from '@backstage/backend-plugin-api';

import { OllamaProvider } from './ollamaProvider';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { VolcengineArkProvider } from './volcengineArkProvider';
import { VolcengineResponsesProvider } from './volcengineResponsesProvider';
import { LlmProviderAdapter, ProviderClientOptions } from './types';

const isOllamaProvider = (provider: string) =>
  ['ollama', 'local-ollama', 'local'].includes(provider.toLowerCase());

const isVolcengineProvider = (provider: string) =>
  ['volcengine', 'volc-ark', 'volcano-ark', 'ark', 'doubao'].includes(
    provider.toLowerCase(),
  );

export const createLlmProviderAdapter = (
  options: ProviderClientOptions,
  logger: LoggerService,
): LlmProviderAdapter => {
  if (isOllamaProvider(options.provider)) {
    logger.info('AI provider adapter: ollama/local');
    return new OllamaProvider(options);
  }

  if (isVolcengineProvider(options.provider)) {
    if (options.apiMode === 'responses') {
      logger.info('AI provider adapter: volcengine-responses');
      return new VolcengineResponsesProvider(options);
    }

    logger.info('AI provider adapter: volcengine-ark');
    return new VolcengineArkProvider(options);
  }

  logger.info('AI provider adapter: openai-compatible');
  return new OpenAICompatibleProvider(options);
};

export * from './types';
