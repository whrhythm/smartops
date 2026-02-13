import { VolcengineArkProvider } from '../volcengineArkProvider';
import { VolcengineResponsesProvider } from '../volcengineResponsesProvider';

const openaiFactoryMock = jest.fn();
const createOpenAIMock = jest.fn(() => openaiFactoryMock);
const generateTextMock = jest.fn();

jest.mock('@ai-sdk/openai', () => ({
  createOpenAI: (...args: any[]) =>
    (createOpenAIMock as (...innerArgs: any[]) => unknown)(...args),
}));

jest.mock('ai', () => ({
  generateText: (...args: any[]) =>
    (generateTextMock as (...innerArgs: any[]) => unknown)(...args),
}));

describe('Volcengine providers', () => {
  beforeEach(() => {
    openaiFactoryMock.mockReset();
    openaiFactoryMock.mockReturnValue({ model: 'mocked-model' });
    createOpenAIMock.mockClear();
    generateTextMock.mockReset();
  });

  describe('VolcengineArkProvider', () => {
    it('uses standard AI SDK openai-compatible config', async () => {
      const provider = new VolcengineArkProvider({
        provider: 'volcengine',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: 'test-key',
        model: 'doubao-seed-1-8-251228',
      });

      generateTextMock.mockResolvedValue({ text: 'hello from ark' });

      const result = await provider.generateText({
        system: 'You are helpful',
        prompt: 'hello',
        temperature: 0.2,
      });

      expect(result).toBe('hello from ark');
      expect(createOpenAIMock).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      });
      expect(openaiFactoryMock).toHaveBeenCalledWith('doubao-seed-1-8-251228');
      expect(generateTextMock).toHaveBeenCalledWith({
        model: { model: 'mocked-model' },
        system: 'You are helpful',
        prompt: 'hello',
        temperature: 0.2,
      });
    });

    it('does not pass X-Volc-Secret even if provided', async () => {
      const provider = new VolcengineArkProvider({
        provider: 'volcengine',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: 'test-key',
        secretKey: 'secret-key',
        model: 'doubao-seed-1-8-251228',
      });

      generateTextMock.mockResolvedValue({ text: 'ok' });

      await provider.generateText({ prompt: 'hello' });

      expect(createOpenAIMock).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      });
    });
  });

  describe('VolcengineResponsesProvider', () => {
    it('uses AI SDK with compatibility mode and no X-Volc-Secret header', async () => {
      const provider = new VolcengineResponsesProvider({
        provider: 'volcengine',
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        apiKey: 'test-key',
        secretKey: 'secret-key',
        model: 'glm-4-7-251222',
        apiMode: 'responses',
      });

      generateTextMock.mockResolvedValue({ text: 'today headlines' });

      const result = await provider.generateText({
        system: 'assistant system',
        prompt: 'today news',
      });

      expect(result).toBe('today headlines');
      expect(createOpenAIMock).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
        compatibility: 'compatible',
      });
      expect(openaiFactoryMock).toHaveBeenCalledWith('glm-4-7-251222');
      expect(generateTextMock).toHaveBeenCalledWith({
        model: { model: 'mocked-model' },
        system: 'assistant system',
        prompt: 'today news',
        temperature: undefined,
      });
    });
  });
});
