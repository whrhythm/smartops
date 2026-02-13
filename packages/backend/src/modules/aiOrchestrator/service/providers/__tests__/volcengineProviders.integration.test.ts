import { VolcengineArkProvider } from '../volcengineArkProvider';

const shouldRunIntegration =
  process.env.RUN_AI_INTEGRATION_TESTS?.toLowerCase() === 'true';

const describeIfIntegration = shouldRunIntegration ? describe : describe.skip;

describeIfIntegration('Volcengine providers integration', () => {
  jest.setTimeout(30000);

  it('calls Volcengine chat completions with real credentials', async () => {
    const apiKey = process.env.AI_LLM_API_KEY;
    const baseUrl =
      process.env.AI_LLM_BASE_URL ?? 'https://ark.cn-beijing.volces.com/api/v3';
    const model = process.env.AI_LLM_MODEL ?? 'doubao-seed-1-8-251228';

    if (!apiKey) {
      throw new Error(
        'Missing AI_LLM_API_KEY. Set it in .env before running integration tests.',
      );
    }

    const provider = new VolcengineArkProvider({
      provider: 'volcengine',
      baseUrl,
      apiKey,
      model,
    });

    console.info(
      `[integration] Volcengine request -> baseUrl=${baseUrl}, model=${model}`,
    );

    const result = await provider.generateText({
      system: 'You are a helpful assistant. Reply with exactly: OK',
      prompt: 'Health check',
      temperature: 0,
    });

    console.info(
      `[integration] Volcengine response <- length=${result.trim().length}, preview=${result
        .trim()
        .slice(0, 120)}`,
    );

    expect(result.trim().length).toBeGreaterThan(0);
  });
});
