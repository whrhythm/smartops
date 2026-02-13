import express from 'express';

import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';

import { readIdentityAsCodeConfig } from './config';
import { withRouteSpan } from '../../observability/httpTracing';
import { createProvisioner } from './provisioners';
import { VClusterProvisionRequest } from './provisioners/types';
import { upsertGitlabFile } from './gitlab';
import { renderSwaggerUi, renderSwaggerUiInitScript } from '../../openapi/swaggerUi';

type RouterOptions = {
  logger: LoggerService;
  config: Config;
};

type IdentityAsCodeRequest = VClusterProvisionRequest;

const identityAsCodeOpenApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Identity-as-Code API',
    version: '0.1.0',
    description:
      'Identity and vCluster provisioning API with GitOps commit and Helm-based provisioner integration.',
  },
  components: {
    schemas: {
      IdentityAsCodeRequest: {
        type: 'object',
        required: ['department', 'team', 'user', 'vcluster'],
        properties: {
          department: { type: 'string' },
          team: { type: 'string' },
          user: {
            type: 'object',
            required: ['username', 'email'],
            properties: {
              username: { type: 'string' },
              email: { type: 'string' },
            },
          },
          vcluster: {
            type: 'object',
            required: ['name', 'cpu', 'memory', 'disk', 'network'],
            properties: {
              name: { type: 'string' },
              cpu: { type: 'string' },
              memory: { type: 'string' },
              disk: { type: 'string' },
              network: { type: 'string' },
            },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Service health',
          },
        },
      },
    },
    '/config': {
      get: {
        summary: 'Get effective integration and provisioner config',
        responses: {
          '200': {
            description: 'Current integration config view',
          },
        },
      },
    },
    '/render': {
      post: {
        summary: 'Render TeamWorkspace manifest from request payload',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IdentityAsCodeRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Manifest rendered' },
          '400': { description: 'Invalid request payload' },
        },
      },
    },
    '/apply': {
      post: {
        summary: 'Commit IaC manifest and trigger vCluster provisioner',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IdentityAsCodeRequest' },
            },
          },
        },
        responses: {
          '200': { description: 'Applied and committed' },
          '400': { description: 'Invalid request payload' },
          '500': { description: 'GitOps or provisioner apply failed' },
        },
      },
    },
  },
};

const renderManifest = (payload: IdentityAsCodeRequest): string => {
  const now = new Date().toISOString();
  return [
    'apiVersion: platform.smartops.io/v1alpha1',
    'kind: TeamWorkspace',
    'metadata:',
    `  name: ${payload.team}`,
    `  department: ${payload.department}`,
    'spec:',
    '  members:',
    `    - username: ${payload.user.username}`,
    `      email: ${payload.user.email}`,
    '  vcluster:',
    `    name: ${payload.vcluster.name}`,
    '    resources:',
    `      cpu: ${payload.vcluster.cpu}`,
    `      memory: ${payload.vcluster.memory}`,
    `      disk: ${payload.vcluster.disk}`,
    `      network: ${payload.vcluster.network}`,
    '  labels:',
    '    managedBy: smartops-identity-as-code',
    `  updatedAt: ${now}`,
    '',
  ].join('\n');
};

const buildFilePath = (basePath: string, team: string): string => {
  const sanitizedTeam = team.toLowerCase().replaceAll(/[^a-z0-9-]/g, '-');
  const normalizedBase = basePath.replace(/\/$/, '');
  return `${normalizedBase}/${sanitizedTeam}.yaml`;
};

export const createRouter = async ({ logger, config }: RouterOptions) => {
  const router = express.Router();
  router.use(express.json({ limit: '1mb' }));

  router.get('/openapi.json', (_, res) => {
    res.json(identityAsCodeOpenApiSpec);
  });

  router.get('/docs', (_, res) => {
    res.type('html').send(renderSwaggerUi('Identity-as-Code API Docs', './openapi.json'));
  });

  router.get('/swagger-ui-init.js', (_, res) => {
    res.type('application/javascript').send(renderSwaggerUiInitScript());
  });

  const iaConfig = readIdentityAsCodeConfig(config);

  router.get('/health', withRouteSpan('identity-as-code.health', (_, res) => {
    res.json({ status: 'ok' });
  }));

  router.get('/config', withRouteSpan('identity-as-code.config.get', (_, res) => {
    res.json({
      integrations: {
        gitlab: {
          baseUrl: iaConfig.integrations.gitlab.baseUrl,
          projectId: iaConfig.integrations.gitlab.projectId,
          defaultBranch: iaConfig.integrations.gitlab.defaultBranch,
          filePath: iaConfig.integrations.gitlab.filePath,
          tokenConfigured: Boolean(iaConfig.integrations.gitlab.token),
        },
        argocd: {
          baseUrl: iaConfig.integrations.argoCd.baseUrl,
        },
        provisioner: {
          driver: iaConfig.provisioner.driver,
          helm: {
            releaseNamespace: iaConfig.provisioner.helm.releaseNamespace,
            chartRef: iaConfig.provisioner.helm.chartRef,
            gitOpsProjectId: iaConfig.provisioner.helm.gitOpsProjectId,
            gitOpsBranch: iaConfig.provisioner.helm.gitOpsBranch,
            gitOpsFilePath: iaConfig.provisioner.helm.gitOpsFilePath,
          },
        },
      },
    });
  }));

  router.post('/render', withRouteSpan('identity-as-code.manifest.render', (req, res) => {
    const payload = req.body as IdentityAsCodeRequest;
    if (!payload?.department || !payload?.team || !payload?.user?.username) {
      res.status(400).json({ error: 'Invalid request payload' });
      return;
    }

    res.json({
      manifest: renderManifest(payload),
    });
  }));

  router.post('/apply', withRouteSpan('identity-as-code.apply', async (req, res) => {
    const payload = req.body as IdentityAsCodeRequest;

    if (
      !payload?.department ||
      !payload?.team ||
      !payload?.user?.username ||
      !payload?.user?.email
    ) {
      res.status(400).json({ error: 'Invalid request payload' });
      return;
    }

    const manifest = renderManifest(payload);
    const filePath = buildFilePath(
      iaConfig.integrations.gitlab.filePath,
      payload.team,
    );

    const responsePayload: Record<string, unknown> = {
      manifestPath: filePath,
      manifest,
    };

    try {
      const { gitlab } = iaConfig.integrations;

      if (gitlab.baseUrl && gitlab.token && gitlab.projectId) {
        const commitResult = await upsertGitlabFile({
          baseUrl: gitlab.baseUrl,
          token: gitlab.token,
          projectId: gitlab.projectId,
          branch: gitlab.defaultBranch,
          filePath,
          content: manifest,
          commitMessage: `identity-as-code: update ${filePath}`,
        });
        responsePayload.gitlab = commitResult;
      } else {
        responsePayload.gitlab = {
          skipped: true,
          reason:
            'Missing GitLab configuration: baseUrl, token, or iacProjectId',
        };
      }

      const provisioner = createProvisioner(iaConfig, logger);
      if (!provisioner) {
        responsePayload.vcluster = {
          skipped: true,
          reason: 'No vCluster provisioner available for current configuration',
        };
      } else {
        const provisionResult = await provisioner.apply(payload);
        responsePayload.vcluster = provisionResult;
      }

      res.json(responsePayload);
    } catch (error) {
      logger.error('Failed to apply identity-as-code request', error as Error);
      res.status(500).json({
        error: (error as Error).message,
        ...responsePayload,
      });
    }
  }));

  return router;
};
