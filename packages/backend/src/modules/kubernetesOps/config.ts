import { Config } from '@backstage/config';

import { FlowableConfig } from '../aiOrchestrator/service/config';

export type KubernetesTenantBinding = {
  tenantId: string;
  clusterName: string;
  namespace: string;
  serviceAccountName: string;
};

export type KubernetesOpsConfig = {
  rancherBaseUrl?: string;
  flowable?: FlowableConfig;
  tenants: KubernetesTenantBinding[];
};

export const readKubernetesOpsConfig = (config: Config): KubernetesOpsConfig => {
  const section = config.getOptionalConfig('kubernetesOps');
  const tenants =
    section
      ?.getOptionalConfigArray('tenants')
      ?.map(item => ({
        tenantId: item.getString('tenantId'),
        clusterName: item.getString('clusterName'),
        namespace: item.getString('namespace'),
        serviceAccountName: item.getString('serviceAccountName'),
      })) ?? [];

  const flowable = section?.has('flowable')
    ? {
        baseUrl: section.getString('flowable.baseUrl'),
        username: section.getString('flowable.username'),
        password: section.getString('flowable.password'),
        processKey: section.getString('flowable.processKey'),
      }
    : undefined;

  return {
    rancherBaseUrl: section?.getOptionalString('rancherBaseUrl') ?? undefined,
    flowable,
    tenants,
  };
};
