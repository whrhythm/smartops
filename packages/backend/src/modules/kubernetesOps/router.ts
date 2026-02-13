import express from 'express';

import { LoggerService } from '@backstage/backend-plugin-api';

import { withRouteSpan } from '../observability/httpTracing';
import { renderSwaggerUi, renderSwaggerUiInitScript } from '../openapi/swaggerUi';
import {
  KubernetesOpsConfig,
  KubernetesTenantBinding,
} from './config';
import { startFlowableApproval } from '../aiOrchestrator/service/flowable';

type RouterOptions = {
  logger: LoggerService;
  config: KubernetesOpsConfig;
};

type KubernetesApprovalRequest = {
  tenantId?: string;
  clusterName?: string;
  namespace?: string;
  serviceAccountName?: string;
  requestedBy?: string;
};

type ScaleRequest = KubernetesApprovalRequest & {
  kind?: 'Deployment' | 'StatefulSet';
  workloadName?: string;
  replicas?: number;
};

type DeployRequest = KubernetesApprovalRequest & {
  applicationName?: string;
  image?: string;
  replicas?: number;
};

const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Kubernetes Operations API',
    version: '0.1.0',
    description:
      'Tenant-aware Kubernetes operation requests. Scale and deploy operations trigger Flowable approval before execution.',
  },
  paths: {
    '/kubernetes/tenants/:tenantId/context': {
      get: {
        summary: 'Get tenant Kubernetes binding context',
        responses: {
          '200': { description: 'Tenant context found' },
          '404': { description: 'Tenant not found' },
        },
      },
    },
    '/kubernetes/requests/scale': {
      post: {
        summary: 'Submit scale request (approval required)',
        responses: {
          '200': { description: 'Approval request submitted' },
          '400': { description: 'Invalid request' },
          '404': { description: 'Tenant context not found' },
          '503': { description: 'Flowable not configured' },
        },
      },
    },
    '/kubernetes/requests/deploy': {
      post: {
        summary: 'Submit deploy request (approval required)',
        responses: {
          '200': { description: 'Approval request submitted' },
          '400': { description: 'Invalid request' },
          '404': { description: 'Tenant context not found' },
          '503': { description: 'Flowable not configured' },
        },
      },
    },
  },
};

const resolveTenantBinding = (
  tenantId: string,
  bindings: KubernetesTenantBinding[],
) => bindings.find(item => item.tenantId === tenantId);

const resolveContextFromRequest = (
  input: KubernetesApprovalRequest,
  bindings: KubernetesTenantBinding[],
) => {
  if (!input.tenantId) {
    return undefined;
  }

  const binding = resolveTenantBinding(input.tenantId, bindings);
  if (!binding) {
    return undefined;
  }

  return {
    tenantId: binding.tenantId,
    clusterName: input.clusterName ?? binding.clusterName,
    namespace: input.namespace ?? binding.namespace,
    serviceAccountName: input.serviceAccountName ?? binding.serviceAccountName,
    requestedBy: input.requestedBy ?? 'unknown',
  };
};

export const createRouter = async ({ logger, config }: RouterOptions) => {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.get('/openapi.json', (_, res) => {
    res.json(openApiSpec);
  });

  router.get('/docs', (_, res) => {
    res
      .type('html')
      .send(renderSwaggerUi('Kubernetes Operations API Docs', './openapi.json'));
  });

  router.get('/swagger-ui-init.js', (_, res) => {
    res.type('application/javascript').send(renderSwaggerUiInitScript());
  });

  router.get(
    '/kubernetes/tenants/:tenantId/context',
    withRouteSpan('kubernetes-ops.tenant.context', (req, res) => {
      const binding = resolveTenantBinding(req.params.tenantId, config.tenants);
      if (!binding) {
        res.status(404).json({ error: `Tenant '${req.params.tenantId}' not found` });
        return;
      }

      res.json({
        tenantId: binding.tenantId,
        clusterName: binding.clusterName,
        namespace: binding.namespace,
        serviceAccountName: binding.serviceAccountName,
        rancherBaseUrl: config.rancherBaseUrl ?? null,
      });
    }),
  );

  router.post(
    '/kubernetes/requests/scale',
    withRouteSpan('kubernetes-ops.request.scale', async (req, res) => {
      const body = req.body as ScaleRequest;
      if (
        !body.tenantId ||
        !body.workloadName ||
        !Number.isFinite(body.replicas) ||
        (body.replicas as number) < 0
      ) {
        res.status(400).json({
          error:
            'tenantId, workloadName and replicas (>=0) are required for scale request',
        });
        return;
      }

      const context = resolveContextFromRequest(body, config.tenants);
      if (!context) {
        res.status(404).json({ error: `Tenant '${body.tenantId}' context not found` });
        return;
      }

      if (!config.flowable) {
        res.status(503).json({ error: 'kubernetesOps.flowable is not configured' });
        return;
      }

      const approval = await startFlowableApproval(config.flowable, {
        businessKey: `k8s-scale:${context.tenantId}:${Date.now()}`,
        payload: {
          operationType: 'scale',
          tenantId: context.tenantId,
          requestedBy: context.requestedBy,
          clusterName: context.clusterName,
          namespace: context.namespace,
          serviceAccountName: context.serviceAccountName,
          kind: body.kind ?? 'Deployment',
          workloadName: body.workloadName,
          replicas: body.replicas,
          approvalRequired: true,
        },
      });

      logger.info(
        `Submitted scale approval for tenant=${context.tenantId}, workload=${body.workloadName}`,
      );
      res.json({ status: 'approval_requested', operationType: 'scale', approval });
    }),
  );

  router.post(
    '/kubernetes/requests/deploy',
    withRouteSpan('kubernetes-ops.request.deploy', async (req, res) => {
      const body = req.body as DeployRequest;
      if (!body.tenantId || !body.applicationName || !body.image) {
        res.status(400).json({
          error:
            'tenantId, applicationName and image are required for deploy request',
        });
        return;
      }

      const context = resolveContextFromRequest(body, config.tenants);
      if (!context) {
        res.status(404).json({ error: `Tenant '${body.tenantId}' context not found` });
        return;
      }

      if (!config.flowable) {
        res.status(503).json({ error: 'kubernetesOps.flowable is not configured' });
        return;
      }

      const approval = await startFlowableApproval(config.flowable, {
        businessKey: `k8s-deploy:${context.tenantId}:${Date.now()}`,
        payload: {
          operationType: 'deploy',
          tenantId: context.tenantId,
          requestedBy: context.requestedBy,
          clusterName: context.clusterName,
          namespace: context.namespace,
          serviceAccountName: context.serviceAccountName,
          applicationName: body.applicationName,
          image: body.image,
          replicas: body.replicas ?? 1,
          approvalRequired: true,
        },
      });

      logger.info(
        `Submitted deploy approval for tenant=${context.tenantId}, app=${body.applicationName}`,
      );
      res.json({ status: 'approval_requested', operationType: 'deploy', approval });
    }),
  );

  return router;
};
