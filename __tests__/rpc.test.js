const { PassThrough } = require('stream');
const EventEmitter = require('events');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
let spawn;

describe('MCP RPC protocol', () => {
  let stdout;
  let stdin;
  let emitter;

  beforeEach(() => {
    jest.resetModules();
    spawn = require('child_process').spawn;
    stdout = new PassThrough();
    stdin = new PassThrough();
    emitter = new EventEmitter();
    spawn.mockReturnValue(Object.assign(emitter, {
      stdout,
      stdin,
      stderr: new PassThrough(),
      on: emitter.on.bind(emitter)
    }));
    process.env.AGENT_PATH = '/tmp/fakeAgent.js';
  });

  test('handles getCapabilities request', async () => {
    const responses = [];
    stdin.on('data', d => responses.push(d.toString()));
    require('../mcpServer');

    stdout.write(JSON.stringify({ id: 1, method: 'getCapabilities' }) + '\n');

    await new Promise(r => setTimeout(r, 10));

    expect(responses.length).toBe(1);
    const resp = JSON.parse(responses[0]);
    expect(resp.id).toBe(1);
    expect(resp.result.functions).toContain('getMarketData');
  });
});
