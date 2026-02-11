import { LoggerService } from '@backstage/backend-plugin-api';

import { IdentityAsCodeConfig } from '../config';
import { HelmProvisioner } from './helmProvisioner';
import { VClusterProvisioner } from './types';

export const createProvisioner = (
  config: IdentityAsCodeConfig,
  logger: LoggerService,
): VClusterProvisioner | null => {
  logger.info('Using Helm vCluster provisioner');
  return new HelmProvisioner({
    releaseNamespace: config.provisioner.helm.releaseNamespace,
    chartRef: config.provisioner.helm.chartRef,
    gitlab: {
      baseUrl: config.integrations.gitlab.baseUrl,
      token: config.integrations.gitlab.token,
      projectId:
        config.provisioner.helm.gitOpsProjectId ??
        config.integrations.gitlab.projectId,
      branch: config.provisioner.helm.gitOpsBranch,
      filePath: config.provisioner.helm.gitOpsFilePath,
    },
  });
};
