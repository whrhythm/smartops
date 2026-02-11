import {
  createApiRef,
  DiscoveryApi,
  IdentityApi,
} from '@backstage/core-plugin-api';

export type AssistantSelectedAction = {
  agentId: string;
  actionId: string;
  title: string;
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  reason: string;
  input: Record<string, unknown>;
};

export type AssistantChatResponse = {
  reply: string;
  selectedAction: AssistantSelectedAction | null;
  execution: unknown;
};

export interface SmartOpsAssistantApi {
  chat(options: {
    text: string;
    tenantId?: string;
    userRef?: string;
    autoExecute?: boolean;
  }): Promise<AssistantChatResponse>;
  chatStream(
    options: {
      text: string;
      tenantId?: string;
      userRef?: string;
      autoExecute?: boolean;
    },
    handlers: {
      onDelta: (chunk: string) => void;
      onDone?: (result: AssistantChatResponse) => void;
    },
  ): Promise<void>;
}

export const smartOpsAssistantApiRef = createApiRef<SmartOpsAssistantApi>({
  id: 'app.smartops.assistant.service',
});

type Options = {
  discoveryApi: DiscoveryApi;
  identityApi: IdentityApi;
};

export class SmartOpsAssistantApiClient implements SmartOpsAssistantApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly identityApi: IdentityApi;

  constructor(options: Options) {
    this.discoveryApi = options.discoveryApi;
    this.identityApi = options.identityApi;
  }

  async chat(options: {
    text: string;
    tenantId?: string;
    userRef?: string;
    autoExecute?: boolean;
  }): Promise<AssistantChatResponse> {
    const baseUrl = await this.discoveryApi.getBaseUrl('ai-orchestrator');
    const { token } = await this.identityApi.getCredentials();

    const response = await fetch(`${baseUrl}/ai-assistant/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(options),
    });

    if (!response.ok) {
      throw new Error(
        `Assistant API error (${response.status}): ${await response.text()}`,
      );
    }

    return (await response.json()) as AssistantChatResponse;
  }

  async chatStream(
    options: {
      text: string;
      tenantId?: string;
      userRef?: string;
      autoExecute?: boolean;
    },
    handlers: {
      onDelta: (chunk: string) => void;
      onDone?: (result: AssistantChatResponse) => void;
    },
  ): Promise<void> {
    const baseUrl = await this.discoveryApi.getBaseUrl('ai-orchestrator');
    const { token } = await this.identityApi.getCredentials();

    const response = await fetch(`${baseUrl}/ai-assistant/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(options),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Assistant stream API error (${response.status}): ${await response.text()}`,
      );
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        const event = JSON.parse(line) as {
          type?: string;
          content?: string;
          reply?: string;
          selectedAction?: AssistantSelectedAction | null;
          execution?: unknown;
          error?: string;
        };

        if (event.type === 'delta' && event.content) {
          handlers.onDelta(event.content);
        }

        if (event.type === 'error') {
          throw new Error(event.error ?? 'Stream failed');
        }

        if (event.type === 'done') {
          handlers.onDone?.({
            reply: event.reply ?? '',
            selectedAction: event.selectedAction ?? null,
            execution: event.execution ?? null,
          });
        }
      }
    }
  }
}
