import { describe, it, expect } from 'vitest';
import { baseAgentName } from '@/lib/agent-name';

describe('baseAgentName', () => {
  it('strips a trailing numeric instance suffix', () => {
    expect(baseAgentName('murdock-1')).toBe('murdock');
    expect(baseAgentName('murdock-2')).toBe('murdock');
    expect(baseAgentName('ba-13')).toBe('ba');
    expect(baseAgentName('lynch-0')).toBe('lynch');
  });

  it('leaves base role names without a suffix unchanged', () => {
    for (const name of ['hannibal', 'face', 'sosa', 'murdock', 'ba', 'lynch', 'amy', 'stockwell', 'tawnia', 'retro']) {
      expect(baseAgentName(name)).toBe(name);
    }
  });

  it('does not strip non-numeric suffixes', () => {
    expect(baseAgentName('ba')).toBe('ba');
    expect(baseAgentName('amy-probe')).toBe('amy-probe');
  });

  it('only strips the last numeric segment', () => {
    expect(baseAgentName('claude-4-6')).toBe('claude-4');
  });
});
