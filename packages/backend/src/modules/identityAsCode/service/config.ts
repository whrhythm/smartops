import { Config } from '@backstage/config';

export type IdentityAsCodeConfig = {
  integrations: {
    gitlab: {
      baseUrl?: string;
      token?: string;
      projectId?: string;
      defaultBranch: string;
      filePath: string;
    };
    argoCd: {
      baseUrl?: string;
    };
  };
  provisioner: {
    driver: 'helm';
    helm: {
      releaseNamespace: string;
      chartRef: string;
      gitOpsProjectId?: string;
      gitOpsBranch: string;
      gitOpsFilePath: string;
    };
  };
};

export const readIdentityAsCodeConfig = (
  config: Config,
): IdentityAsCodeConfig => {
  const driver = 'helm';

  return {
    integrations: {
    gitlab: {
      baseUrl: config.getOptionalString('smartops.integrations.gitlab.baseUrl'),
      token: config.getOptionalString('smartops.integrations.gitlab.token'),
      projectId: config.getOptionalString(
        'smartops.integrations.gitlab.iacProjectId',
      ),
      defaultBranch:
        config.getOptionalString(
          'smartops.identityAsCode.repo.defaultBranch',
        ) ?? 'main',
      filePath:
        config.getOptionalString('smartops.identityAsCode.repo.filePath') ??
        'org/structure.yaml',
    },
    argoCd: {
      baseUrl: config.getOptionalString('smartops.integrations.argocd.baseUrl'),
    },
  },
    provisioner: {
      driver,
      helm: {
        releaseNamespace:
          config.getOptionalString(
            'smartops.vcluster.provisioner.helm.releaseNamespace',
          ) ?? 'vcluster-system',
        chartRef:
          config.getOptionalString('smartops.vcluster.provisioner.helm.chartRef') ??
          'ghcr.io/loft-sh/vcluster-chart',
        gitOpsProjectId: config.getOptionalString(
          'smartops.vcluster.provisioner.helm.gitOpsProjectId',
        ),
        gitOpsBranch:
          config.getOptionalString(
            'smartops.vcluster.provisioner.helm.gitOpsBranch',
          ) ??
          config.getOptionalString('smartops.identityAsCode.repo.defaultBranch') ??
          'main',
        gitOpsFilePath:
          config.getOptionalString(
            'smartops.vcluster.provisioner.helm.gitOpsFilePath',
          ) ?? 'gitops/vcluster',
      },
    },
  };
};
