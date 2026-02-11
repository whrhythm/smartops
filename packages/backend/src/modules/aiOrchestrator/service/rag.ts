import fetch from 'node-fetch';
import { DiscoveryService, LoggerService } from '@backstage/backend-plugin-api';

type RagOptions = {
  discovery: DiscoveryService;
  query: string;
  logger: LoggerService;
  maxResults: number;
  tenantId?: string;
  tenantFilterKey?: string;
};

type SearchResult = {
  document?: {
    title?: string;
    text?: string;
    location?: string;
  };
};

export const fetchRagContext = async ({
  discovery,
  query,
  logger,
  maxResults,
  tenantId,
  tenantFilterKey,
}: RagOptions) => {
  if (!query.trim()) {
    return '';
  }

  try {
    const baseUrl = await discovery.getBaseUrl('search');
    const payload: Record<string, unknown> = {
      term: query,
      pageLimit: maxResults,
    };

    if (tenantId && tenantFilterKey) {
      payload.filters = {
        [tenantFilterKey]: [tenantId],
      };
    }

    const response = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      logger.warn(`Search query failed: ${response.status} ${text}`);
      return '';
    }

    const data = (await response.json()) as { results?: SearchResult[] };
    const results = data.results ?? [];

    const snippets = results
      .map(result => {
        const title = result.document?.title ?? 'Untitled';
        const text = result.document?.text ?? '';
        const location = result.document?.location ?? '';
        return `Title: ${title}\nLocation: ${location}\nContent: ${text}`.trim();
      })
      .filter(Boolean)
      .slice(0, maxResults);

    return snippets.join('\n\n');
  } catch (error) {
    logger.warn(`RAG fetch failed: ${(error as Error).message}`);
    return '';
  }
};
