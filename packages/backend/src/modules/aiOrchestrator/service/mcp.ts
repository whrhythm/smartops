import fetch from 'node-fetch';

import { McpServerConfig } from './config';

export type McpExecuteRequest = {
  tenantId: string;
  userRef: string;
  input: string;
};

export const executeMcpAction = async (
  server: McpServerConfig,
  request: McpExecuteRequest,
) => {
  const response = await fetch(`${server.baseUrl}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP error ${response.status}: ${text}`);
  }

  return response.json();
};
