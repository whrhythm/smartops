import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

import {
  LlmProviderAdapter,
  ProviderClientOptions,
  ProviderGenerateParams,
} from './types';

export class VolcengineArkProvider implements LlmProviderAdapter {
  readonly provider: string;

  private readonly model: string;

  private readonly apiKey: string;

  private readonly baseUrl: string;

  constructor(options: ProviderClientOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
  }

  async generateText(params: ProviderGenerateParams): Promise<string> {
    const openai = createOpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseUrl,
    });

    const model = openai(this.model) as unknown as any;
    const result = await generateText({
      model,
      system: params.system,
      prompt: params.prompt,
      temperature: params.temperature,
    });

    return result.text?.trim() ?? '';
  }
}
