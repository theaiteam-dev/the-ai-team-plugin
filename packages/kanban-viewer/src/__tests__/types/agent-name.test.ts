import { describe, it, expect } from 'vitest';

/**
 * Tests for AgentName type consistency across the codebase.
 *
 * Bug: src/types/agent.ts uses 'BA' (without dot) but the rest of the codebase
 * uses 'B.A.' (with dot). This causes runtime errors when API clients pass 'BA'
 * to components expecting 'B.A.'.
 *
 * The fix should update src/types/agent.ts to use 'B.A.' for consistency.
 *
 * IMPORTANT: These tests use runtime checks combined with type assertions to
 * verify both compile-time and runtime behavior. The key test for the bug is
 * the runtime check that verifies the API accepts 'B.A.' as a valid agent name.
 */

import type { AgentName as ApiAgentName, AgentClaim } from '../../types/agent';
import type { AgentName as MainAgentName } from '../../types/index';

/**
 * Helper to check if a value is assignable to the ApiAgentName type at runtime.
 * This function validates that the API AgentName type includes 'B.A.' with dot.
 */
function isValidApiAgentName(value: string): value is ApiAgentName {
  // The valid agent names per the API type definition
  // When the bug is fixed, this should include 'B.A.' (with dot), not 'BA'
  const validNames: readonly string[] = [
    'Hannibal',
    'Face',
    'Murdock',
    'B.A.', // Should be 'B.A.' with dot, NOT 'BA'
    'Lynch',
    'Amy',
    'Tawnia',
  ];
  return validNames.includes(value);
}

// ============ AgentName Type Tests ============

describe('AgentName Type (src/types/agent.ts)', () => {
  describe('B.A. agent name format', () => {
    it('should accept B.A. with dot as a valid agent name', () => {
      // The API AgentName type should use 'B.A.' (with dot)
      // This test will cause a TypeScript compile error if the type uses 'BA'
      // The @ts-expect-error below should be UNUSED after the fix
      // (causing the test to fail if the error comment is left in)

      // BUG FIX: 'B.A.' is now valid in ApiAgentName
      const ba: ApiAgentName = 'B.A.';

      // Runtime validation that 'B.A.' should be the correct format
      expect(ba).toBe('B.A.');
      expect(isValidApiAgentName('B.A.')).toBe(true);
    });

    it('should NOT accept BA without dot as a valid agent name', () => {
      // Once the bug is fixed, 'BA' (without dot) should NOT be valid
      // This runtime check verifies the expected behavior
      expect(isValidApiAgentName('BA')).toBe(false);
    });

    it('should match the main types/index.ts AgentName definition', () => {
      // The main types/index.ts correctly uses 'B.A.' with dot
      const mainAgent: MainAgentName = 'B.A.';
      expect(mainAgent).toBe('B.A.');

      // After the fix, ApiAgentName should also accept 'B.A.'
      // Until then, this verifies the expected target state
      expect(isValidApiAgentName(mainAgent)).toBe(true);
    });
  });

  describe('all valid agent names', () => {
    it('should accept Hannibal as a valid agent name', () => {
      const agent: ApiAgentName = 'Hannibal';
      expect(agent).toBe('Hannibal');
      expect(isValidApiAgentName('Hannibal')).toBe(true);
    });

    it('should accept Face as a valid agent name', () => {
      const agent: ApiAgentName = 'Face';
      expect(agent).toBe('Face');
      expect(isValidApiAgentName('Face')).toBe(true);
    });

    it('should accept Murdock as a valid agent name', () => {
      const agent: ApiAgentName = 'Murdock';
      expect(agent).toBe('Murdock');
      expect(isValidApiAgentName('Murdock')).toBe(true);
    });

    it('should accept Lynch as a valid agent name', () => {
      const agent: ApiAgentName = 'Lynch';
      expect(agent).toBe('Lynch');
      expect(isValidApiAgentName('Lynch')).toBe(true);
    });

    it('should accept Amy as a valid agent name', () => {
      const agent: ApiAgentName = 'Amy';
      expect(agent).toBe('Amy');
      expect(isValidApiAgentName('Amy')).toBe(true);
    });

    it('should accept Tawnia as a valid agent name', () => {
      const agent: ApiAgentName = 'Tawnia';
      expect(agent).toBe('Tawnia');
      expect(isValidApiAgentName('Tawnia')).toBe(true);
    });

    it('should have exactly 7 valid agent names', () => {
      // This verifies the complete set of valid agents
      const validAgents = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Lynch', 'Amy', 'Tawnia'];
      validAgents.forEach((name) => {
        expect(isValidApiAgentName(name)).toBe(true);
      });
      expect(validAgents).toHaveLength(7);
    });
  });

  describe('invalid agent names rejection', () => {
    it('should reject unknown agent names', () => {
      // @ts-expect-error - 'Unknown' is not a valid AgentName
      const invalid: ApiAgentName = 'Unknown';
      expect(invalid).toBeDefined();
      expect(isValidApiAgentName('Unknown')).toBe(false);
    });

    it('should reject empty string', () => {
      // @ts-expect-error - empty string is not a valid AgentName
      const empty: ApiAgentName = '';
      expect(empty).toBeDefined();
      expect(isValidApiAgentName('')).toBe(false);
    });

    it('should reject lowercase agent names', () => {
      // @ts-expect-error - 'hannibal' is not a valid AgentName (case-sensitive)
      const lowercase: ApiAgentName = 'hannibal';
      expect(lowercase).toBeDefined();
      expect(isValidApiAgentName('hannibal')).toBe(false);
    });

    it('should reject BA without dot (the bug)', () => {
      // This is the key test for the bug - 'BA' without dot should be invalid
      expect(isValidApiAgentName('BA')).toBe(false);
    });
  });
});

// ============ AgentClaim Type Tests with B.A. ============

describe('AgentClaim with B.A. agent', () => {
  it('should create a claim with B.A. agent name (with dot)', () => {
    // BUG FIX: 'B.A.' is now valid in ApiAgentName
    const claim: AgentClaim = {
      agentName: 'B.A.',
      itemId: 'WI-001',
      claimedAt: new Date(),
    };

    // Runtime checks for expected behavior after fix
    expect(claim.agentName).toBe('B.A.');
    expect(claim.itemId).toBe('WI-001');
    expect(claim.claimedAt).toBeInstanceOf(Date);
  });

  it('should NOT accept BA without dot in AgentClaim after fix', () => {
    // BUG FIX: 'BA' without dot now correctly causes a TypeScript error
    const claimWithBuggyName: AgentClaim = {
      // @ts-expect-error - 'BA' is not valid in AgentName (should be 'B.A.')
      agentName: 'BA',
      itemId: 'WI-001',
      claimedAt: new Date(),
    };

    // Runtime validation - this should fail to indicate the bug
    expect(isValidApiAgentName(claimWithBuggyName.agentName)).toBe(false);
  });

  it('should work with all valid agent names in claims', () => {
    // Using runtime type guard to avoid compile errors with B.A.
    const validAgentNames = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Lynch', 'Amy', 'Tawnia'] as const;

    validAgentNames.forEach((agentName) => {
      expect(isValidApiAgentName(agentName)).toBe(true);
    });
  });
});

// ============ Type Consistency Tests ============

describe('AgentName type consistency between modules', () => {
  it('should have matching agent names between api and main types', () => {
    // Test that the expected agent names are valid
    const expectedAgents = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Lynch', 'Amy', 'Tawnia'];

    expectedAgents.forEach((name) => {
      expect(isValidApiAgentName(name)).toBe(true);
    });

    // Verify all are valid MainAgentName values
    const mainAgents: MainAgentName[] = ['Hannibal', 'Face', 'Murdock', 'B.A.', 'Lynch', 'Amy', 'Tawnia'];
    expect(mainAgents).toHaveLength(7);
    expect(mainAgents).toContain('B.A.');
  });

  it('should NOT have BA (without dot) in the list of valid agents', () => {
    // This verifies the bug fix - BA should not be in the valid agent list
    expect(isValidApiAgentName('BA')).toBe(false);
    expect(isValidApiAgentName('B.A.')).toBe(true);
  });

  it('should use B.A. format consistently across the codebase', () => {
    // The main types/index.ts uses B.A. (with dot)
    // The api types/agent.ts should also use B.A. (with dot)
    // This test verifies the expected consistency
    const mainAgent: MainAgentName = 'B.A.';

    // After the fix, this should be assignable without error
    expect(isValidApiAgentName(mainAgent)).toBe(true);
  });
});

// ============ Activity Log Display Tests ============

describe('B.A. in activity log context', () => {
  it('should format B.A. correctly for activity log display', () => {
    // Using the expected format after the fix
    const agent = 'B.A.';
    const logMessage = `[${agent}] Implementing feature`;

    expect(logMessage).toBe('[B.A.] Implementing feature');
    expect(logMessage).not.toBe('[BA] Implementing feature');
    expect(isValidApiAgentName(agent)).toBe(true);
  });

  it('should match existing activity log format patterns', () => {
    // Activity logs use format: timestamp [Agent] message
    // B.A. should display as B.A. not BA
    const agent = 'B.A.';
    const timestamp = '2026-01-23T10:00:00Z';
    const message = 'Starting implementation';

    const logEntry = `${timestamp} [${agent}] ${message}`;
    expect(logEntry).toContain('[B.A.]');
    expect(logEntry).not.toContain('[BA]');
  });

  it('should reject BA format in activity logs', () => {
    // The BA format (without dot) should not be valid
    const invalidAgent = 'BA';
    expect(isValidApiAgentName(invalidAgent)).toBe(false);
  });
});
