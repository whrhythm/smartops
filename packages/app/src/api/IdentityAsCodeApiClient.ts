import {
  createApiRef,
  DiscoveryApi,
  IdentityApi,
} from '@backstage/core-plugin-api';

export type IdentityAsCodeForm = {
  department: string;
  team: string;
  user: {
    username: string;
    email: string;
  };
  vcluster: {
    name: string;
    cpu: string;
    memory: string;
    disk: string;
    network: string;
  };
};

export type IdentityAsCodeConfig = {
  integrations: {
    gitlab: {
      baseUrl?: string;
      projectId?: string;
      defaultBranch: string;
      filePath: string;
      tokenConfigured: boolean;
    };
    argocd: {
      baseUrl?: string;
    };
    provisioner?: {
      driver: 'helm';
      helm?: {
        releaseNamespace: string;
        chartRef: string;
        gitOpsProjectId?: string;
        gitOpsBranch: string;
        gitOpsFilePath: string;
      };
    };
  };
};

export type ApplyIdentityAsCodeResult = {
  manifestPath: string;
  manifest: string;
  gitlab?: {
    skipped?: boolean;
    reason?: string;
    action?: 'create' | 'update';
    commitId?: string;
    webUrl?: string;
  };
  vcluster?: {
    skipped?: boolean;
    reason?: string;
    [key: string]: unknown;
  };
  error?: string;
};

export interface IdentityAsCodeApi {
  getConfig(): Promise<IdentityAsCodeConfig>;
  render(payload: IdentityAsCodeForm): Promise<{ manifest: string }>;
  apply(payload: IdentityAsCodeForm): Promise<ApplyIdentityAsCodeResult>;
}

export const identityAsCodeApiRef = createApiRef<IdentityAsCodeApi>({
  id: 'app.smartops.identity-as-code.service',
});

type Options = {
  discoveryApi: DiscoveryApi;
  identityApi: IdentityApi;
};

export class IdentityAsCodeApiClient implements IdentityAsCodeApi {
  private readonly discoveryApi: DiscoveryApi;
  private readonly identityApi: IdentityApi;

  constructor(options: Options) {
    this.discoveryApi = options.discoveryApi;
    this.identityApi = options.identityApi;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const { token } = await this.identityApi.getCredentials();
    const baseUrl = await this.discoveryApi.getBaseUrl('identity-as-code');
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `Identity-as-Code API error (${response.status}): ${message}`,
      );
    }

    return (await response.json()) as T;
  }

  async getConfig(): Promise<IdentityAsCodeConfig> {
    return this.request('/config');
  }

  async render(payload: IdentityAsCodeForm): Promise<{ manifest: string }> {
    return this.request('/render', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async apply(payload: IdentityAsCodeForm): Promise<ApplyIdentityAsCodeResult> {
    return this.request('/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}
