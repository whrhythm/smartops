import fetch from 'node-fetch';

import { FlowableConfig } from './config';

export type FlowableApprovalRequest = {
  businessKey: string;
  payload: Record<string, unknown>;
};

export const startFlowableApproval = async (
  config: FlowableConfig,
  request: FlowableApprovalRequest,
) => {
  const url = `${config.baseUrl}/flowable-task/process-api/runtime/process-instances`;
  const body = {
    processDefinitionKey: config.processKey,
    businessKey: request.businessKey,
    variables: Object.entries(request.payload).map(([name, value]) => ({
      name,
      value,
    })),
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(
        `${config.username}:${config.password}`,
      ).toString('base64')}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Flowable error ${response.status}: ${text}`);
  }

  return response.json();
};
