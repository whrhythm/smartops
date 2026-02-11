export type VClusterProvisionRequest = {
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

export type VClusterProvisionResult = {
  provider: 'helm';
  mode: 'applied' | 'planned';
  details: Record<string, unknown>;
};

export interface VClusterProvisioner {
  readonly provider: 'helm';
  apply(payload: VClusterProvisionRequest): Promise<VClusterProvisionResult>;
}
