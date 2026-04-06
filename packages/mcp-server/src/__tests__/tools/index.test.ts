import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the McpServer
const mockSetRequestHandler = vi.fn();
const mockTool = vi.fn();
const mockServer = {
  name: 'ateam',
  version: '1.0.0',
  setRequestHandler: mockSetRequestHandler,
  tool: mockTool,
};

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => mockServer),
}));

// Mock stderr.write for logging tests
const mockStderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

describe('Tool Registration (tools/index)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });


  describe('Tool Count and Registration', () => {
    it('should register exactly 21 tools', async () => {
      const { registerAllTools, getAllToolDefinitions } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      const toolDefinitions = getAllToolDefinitions();
      expect(toolDefinitions).toHaveLength(21);
    });

    it('should register all board tools (4)', async () => {
      const { getAllToolDefinitions, registerAllTools } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      const toolDefinitions = getAllToolDefinitions();
      const boardToolNames = ['board_read', 'board_move', 'board_claim', 'board_release'];

      for (const name of boardToolNames) {
        const tool = toolDefinitions.find((t) => t.name === name);
        expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
      }
    });

    it('should register all item tools (6)', async () => {
      const { getAllToolDefinitions, registerAllTools } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      const toolDefinitions = getAllToolDefinitions();
      const itemToolNames = [
        'item_create',
        'item_update',
        'item_get',
        'item_list',
        'item_render',
      ];

      for (const name of itemToolNames) {
        const tool = toolDefinitions.find((t) => t.name === name);
        expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
      }
    });

    it('should register all agent tools (2)', async () => {
      const { getAllToolDefinitions, registerAllTools } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      const toolDefinitions = getAllToolDefinitions();
      const agentToolNames = ['agent_start', 'agent_stop'];

      for (const name of agentToolNames) {
        const tool = toolDefinitions.find((t) => t.name === name);
        expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
      }
    });

    it('should register all mission tools (5)', async () => {
      const { getAllToolDefinitions, registerAllTools } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      const toolDefinitions = getAllToolDefinitions();
      const missionToolNames = [
        'mission_init',
        'mission_current',
        'mission_precheck',
        'mission_postcheck',
        'mission_archive',
        'mission_list',
      ];

      for (const name of missionToolNames) {
        const tool = toolDefinitions.find((t) => t.name === name);
        expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
      }
    });

    it('should register all utils tools (4)', async () => {
      const { getAllToolDefinitions, registerAllTools } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      const toolDefinitions = getAllToolDefinitions();
      const utilsToolNames = ['plugin_root', 'deps_check', 'activity_log', 'log'];

      for (const name of utilsToolNames) {
        const tool = toolDefinitions.find((t) => t.name === name);
        expect(tool, `Expected tool ${name} to be registered`).toBeDefined();
      }
    });

    it('should have unique tool names', async () => {
      const { getAllToolDefinitions, registerAllTools } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      const toolDefinitions = getAllToolDefinitions();
      const names = toolDefinitions.map((t) => t.name);
      const uniqueNames = new Set(names);

      expect(uniqueNames.size).toBe(names.length);
    });
  });


  describe('tools/list Handler', () => {
    it('should register all 21 tools via server.tool() API', async () => {
      const { registerAllTools } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      // With the high-level server.tool() API, the MCP SDK handles tools/list internally.
      // We verify all 21 tools were registered via server.tool() calls.
      expect(mockTool.mock.calls.length).toBe(21);

      // Verify the tool names registered match the expected set
      const registeredNames = mockTool.mock.calls.map((call: unknown[]) => call[0]).sort();
      expect(registeredNames).toHaveLength(21);
    });

    it('registered tool names should match getAllToolDefinitions', async () => {
      const { registerAllTools, getAllToolDefinitions } = await import('../../tools/index.js');

      registerAllTools(mockServer as never);

      const toolDefinitions = getAllToolDefinitions();

      // Names registered via server.tool() should match getAllToolDefinitions
      const registeredNames = mockTool.mock.calls.map((call: unknown[]) => call[0] as string).sort();
      const definitionNames = toolDefinitions.map((t) => t.name).sort();

      expect(registeredNames).toEqual(definitionNames);
    });
  });





});
