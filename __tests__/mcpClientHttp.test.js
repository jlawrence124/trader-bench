const axios = require('axios');
jest.mock('axios');

const MCPClient = require('../lib/shared/mcpClient');

describe('MCPClient HTTP mode', () => {
  beforeEach(() => {
    axios.post.mockReset();
    process.env.MCP_SERVER_URL = 'http://localhost:1234/rpc';
  });

  test('sends HTTP request when MCP_SERVER_URL is set', async () => {
    axios.post.mockResolvedValue({ data: { id: '1', result: { ok: true } } });
    const logger = { info: jest.fn(), debug: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const client = new MCPClient(logger);
    const res = await client.getCapabilities();
    expect(axios.post).toHaveBeenCalledWith('http://localhost:1234/rpc', expect.any(Object), { timeout: 30000 });
    expect(res).toEqual({ ok: true });
  });
});
