import { VClusterProvisionRequest, VClusterProvisionResult, VClusterProvisioner } from './types';
import { upsertGitlabFile } from '../gitlab';

type HelmProvisionerOptions = {
  releaseNamespace: string;
  chartRef: string;
  gitlab?: {
    baseUrl?: string;
    token?: string;
    projectId?: string;
    branch: string;
    filePath: string;
  };
};

export class HelmProvisioner implements VClusterProvisioner {
  readonly provider = 'helm' as const;

  private readonly releaseNamespace: string;

  private readonly chartRef: string;

  private readonly gitlab?: {
    baseUrl?: string;
    token?: string;
    projectId?: string;
    branch: string;
    filePath: string;
  };

  constructor(options: HelmProvisionerOptions) {
    this.releaseNamespace = options.releaseNamespace;
    this.chartRef = options.chartRef;
    this.gitlab = options.gitlab;
  }

  private renderValues(payload: VClusterProvisionRequest): string {
    return [
      `vclusterName: ${payload.vcluster.name}`,
      `team: ${payload.team}`,
      `department: ${payload.department}`,
      `releaseNamespace: ${this.releaseNamespace}`,
      `chartRef: ${this.chartRef}`,
      'resources:',
      `  cpu: "${payload.vcluster.cpu}"`,
      `  memory: "${payload.vcluster.memory}"`,
      `  disk: "${payload.vcluster.disk}"`,
      `  network: "${payload.vcluster.network}"`,
      'owner:',
      `  username: ${payload.user.username}`,
      `  email: ${payload.user.email}`,
      '',
    ].join('\n');
  }

  private getGitOpsFilePath(team: string): string {
    const sanitizedTeam = team.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-');
    const basePath = this.gitlab?.filePath ?? 'gitops/vcluster';
    const normalized = basePath.replace(/\/$/, '');
    return `${normalized}/${sanitizedTeam}-values.yaml`;
  }

  async apply(
    payload: VClusterProvisionRequest,
  ): Promise<VClusterProvisionResult> {
    const valuesYaml = this.renderValues(payload);
    const filePath = this.getGitOpsFilePath(payload.team);

    const gitlab = this.gitlab;
    if (!gitlab?.baseUrl || !gitlab.token || !gitlab.projectId) {
      return {
        provider: this.provider,
        mode: 'planned',
        details: {
          message:
            'Helm provisioner selected but GitLab GitOps target is incomplete; generated values returned for manual apply.',
          releaseNamespace: this.releaseNamespace,
          chartRef: this.chartRef,
          valuesPath: filePath,
          valuesYaml,
        },
      };
    }

    const commit = await upsertGitlabFile({
      baseUrl: gitlab.baseUrl,
      token: gitlab.token,
      projectId: gitlab.projectId,
      branch: gitlab.branch,
      filePath,
      content: valuesYaml,
      commitMessage: `vcluster-helm: apply ${payload.team}`,
    });

    return {
      provider: this.provider,
      mode: 'applied',
      details: {
        message:
          'Helm values have been committed to GitOps repository. Argo CD can reconcile from this commit.',
        releaseNamespace: this.releaseNamespace,
        chartRef: this.chartRef,
        valuesPath: filePath,
        commit,
      },
    };
  }
}
