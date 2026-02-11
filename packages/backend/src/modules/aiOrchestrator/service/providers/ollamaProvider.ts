import {
  LlmProviderAdapter,
  ProviderClientOptions,
  ProviderGenerateParams,
} from './types';

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

export class OllamaProvider implements LlmProviderAdapter {
  readonly provider: string;

  private readonly baseUrl: string;

  private readonly model: string;

  constructor(options: ProviderClientOptions) {
    this.provider = options.provider;
    this.baseUrl = options.baseUrl;
    this.model = options.model;
  }

  async generateText(params: ProviderGenerateParams): Promise<string> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
    if (params.system) {
      messages.push({
        role: 'system',
        content: params.system,
      });
    }
    messages.push({
      role: 'user',
      content: params.prompt,
    });

    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        options: {
          temperature: params.temperature,
        },
        messages,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama request failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as OllamaChatResponse;
    return data.message?.content?.trim() ?? '';
  }
}
