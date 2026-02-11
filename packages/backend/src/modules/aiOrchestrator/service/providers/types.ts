export type ProviderGenerateParams = {
  system?: string;
  prompt: string;
  temperature?: number;
};

export interface LlmProviderAdapter {
  readonly provider: string;
  generateText(params: ProviderGenerateParams): Promise<string>;
}

export type ProviderClientOptions = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};
