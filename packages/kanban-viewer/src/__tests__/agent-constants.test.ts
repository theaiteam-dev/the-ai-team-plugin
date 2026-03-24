import { describe, it, expect } from 'vitest';
import type { AgentName } from '../types';
import {
  AGENT_NAMES,
  AGENT_INITIALS,
  AGENT_COLORS,
} from '../components/agent-status-bar';
import { agentColors } from '../components/live-feed-panel';

/**
 * Tests for agent constants - verifies colors and configuration for all 8 agents
 * including Amy (pink), Tawnia (teal), and Stockwell (gray).
 */
describe('Agent Constants', () => {
  describe('AGENT_NAMES array', () => {
    it('should include exactly 8 agents', () => {
      expect(AGENT_NAMES).toHaveLength(8);
    });

    it('should include Amy', () => {
      expect(AGENT_NAMES).toContain('Amy');
    });

    it('should include Tawnia', () => {
      expect(AGENT_NAMES).toContain('Tawnia');
    });

    it('should include all original agents', () => {
      expect(AGENT_NAMES).toContain('Hannibal');
      expect(AGENT_NAMES).toContain('Face');
      expect(AGENT_NAMES).toContain('Murdock');
      expect(AGENT_NAMES).toContain('B.A.');
      expect(AGENT_NAMES).toContain('Lynch');
    });
  });

  describe('AGENT_COLORS', () => {
    it('should have Amy with pink color (bg-pink-500)', () => {
      expect(AGENT_COLORS['Amy']).toBe('bg-pink-500');
    });

    it('should have Tawnia with teal color (bg-teal-500)', () => {
      expect(AGENT_COLORS['Tawnia']).toBe('bg-teal-500');
    });

    it('should have colors for all 8 agents', () => {
      const expectedAgents: AgentName[] = [
        'Hannibal',
        'Face',
        'Murdock',
        'B.A.',
        'Amy',
        'Lynch',
        'Tawnia',
        'Stockwell',
      ];
      expectedAgents.forEach((agent) => {
        expect(AGENT_COLORS[agent]).toBeDefined();
        expect(typeof AGENT_COLORS[agent]).toBe('string');
      });
    });

    it('should preserve original agent colors', () => {
      expect(AGENT_COLORS['Hannibal']).toBe('bg-green-500');
      expect(AGENT_COLORS['Face']).toBe('bg-cyan-500');
      expect(AGENT_COLORS['Murdock']).toBe('bg-amber-500');
      expect(AGENT_COLORS['B.A.']).toBe('bg-red-500');
      expect(AGENT_COLORS['Lynch']).toBe('bg-blue-500');
    });
  });

  describe('AGENT_INITIALS', () => {
    it('should have A for Amy', () => {
      expect(AGENT_INITIALS['Amy']).toBe('A');
    });

    it('should have T for Tawnia', () => {
      expect(AGENT_INITIALS['Tawnia']).toBe('T');
    });

    it('should have initials for all 7 agents', () => {
      const expectedAgents: AgentName[] = [
        'Hannibal',
        'Face',
        'Murdock',
        'B.A.',
        'Amy',
        'Lynch',
        'Tawnia',
      ];
      expectedAgents.forEach((agent) => {
        expect(AGENT_INITIALS[agent]).toBeDefined();
        expect(typeof AGENT_INITIALS[agent]).toBe('string');
        expect(AGENT_INITIALS[agent].length).toBe(1);
      });
    });

    it('should preserve original agent initials', () => {
      expect(AGENT_INITIALS['Hannibal']).toBe('H');
      expect(AGENT_INITIALS['Face']).toBe('F');
      expect(AGENT_INITIALS['Murdock']).toBe('M');
      expect(AGENT_INITIALS['B.A.']).toBe('B');
      expect(AGENT_INITIALS['Lynch']).toBe('L');
    });
  });

  describe('Live feed panel agentColors', () => {
    it('should have Amy with pink text color (text-pink-500)', () => {
      expect(agentColors['Amy']).toBe('text-pink-500');
    });

    it('should have Tawnia with teal text color (text-teal-500)', () => {
      expect(agentColors['Tawnia']).toBe('text-teal-500');
    });

    it('should have colors for all 8 agents', () => {
      const expectedAgents: AgentName[] = [
        'Hannibal',
        'Face',
        'Murdock',
        'B.A.',
        'Amy',
        'Lynch',
        'Tawnia',
        'Stockwell',
      ];
      expectedAgents.forEach((agent) => {
        expect(agentColors[agent]).toBeDefined();
        expect(typeof agentColors[agent]).toBe('string');
        expect(agentColors[agent]).toMatch(/^text-/);
      });
    });

    it('should preserve original agent text colors', () => {
      expect(agentColors['Hannibal']).toBe('text-green-500');
      expect(agentColors['Face']).toBe('text-cyan-500');
      expect(agentColors['Murdock']).toBe('text-amber-500');
      expect(agentColors['B.A.']).toBe('text-red-500');
      expect(agentColors['Lynch']).toBe('text-blue-500');
    });
  });

  describe('Export availability', () => {
    it('should export AGENT_NAMES from agent-status-bar', () => {
      expect(AGENT_NAMES).toBeDefined();
      expect(Array.isArray(AGENT_NAMES)).toBe(true);
    });

    it('should export AGENT_COLORS from agent-status-bar', () => {
      expect(AGENT_COLORS).toBeDefined();
      expect(typeof AGENT_COLORS).toBe('object');
    });

    it('should export AGENT_INITIALS from agent-status-bar', () => {
      expect(AGENT_INITIALS).toBeDefined();
      expect(typeof AGENT_INITIALS).toBe('object');
    });

    it('should export agentColors from live-feed-panel', () => {
      expect(agentColors).toBeDefined();
      expect(typeof agentColors).toBe('object');
    });
  });
});
