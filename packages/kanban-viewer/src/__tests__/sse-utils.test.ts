import { describe, it, expect } from 'vitest';
import { formatSSEEvent, parseSSEEvent } from '../lib/sse-utils';
import type { BoardEvent, BoardEventType, WorkItem, BoardMetadata } from '@/types';

describe('SSE Utils', () => {
  describe('formatSSEEvent', () => {
    it('should format item-added event correctly', () => {
      const item: WorkItem = {
        id: '001',
        title: 'New Feature',
        type: 'feature',
        status: 'ready',
        rejection_count: 0,
        dependencies: [],
        outputs: {},
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
        stage: 'briefings',
        content: 'Test content',
      };

      const event: BoardEvent = {
        type: 'item-added',
        timestamp: '2026-01-15T10:30:00Z',
        data: {
          itemId: '001',
          item,
        },
      };

      const result = formatSSEEvent(event);

      expect(result).toContain('data: ');
      expect(result).toContain('"type":"item-added"');
      expect(result).toContain('"timestamp":"2026-01-15T10:30:00Z"');
      expect(result).toContain('"itemId":"001"');
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should format item-moved event correctly', () => {
      const event: BoardEvent = {
        type: 'item-moved',
        timestamp: '2026-01-15T11:00:00Z',
        data: {
          itemId: '002',
          fromStage: 'ready',
          toStage: 'testing',
        },
      };

      const result = formatSSEEvent(event);

      expect(result).toContain('data: ');
      expect(result).toContain('"type":"item-moved"');
      expect(result).toContain('"fromStage":"ready"');
      expect(result).toContain('"toStage":"testing"');
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should format item-updated event correctly', () => {
      const item: WorkItem = {
        id: '003',
        title: 'Updated Feature',
        type: 'enhancement',
        status: 'in-progress',
        rejection_count: 1,
        dependencies: ['001'],
        outputs: {
          test: 'src/__tests__/feature.test.ts',
          impl: 'src/lib/feature.ts',
        },
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T12:00:00Z',
        stage: 'implementing',
        content: 'Updated content',
      };

      const event: BoardEvent = {
        type: 'item-updated',
        timestamp: '2026-01-15T12:00:00Z',
        data: {
          itemId: '003',
          item,
        },
      };

      const result = formatSSEEvent(event);

      expect(result).toContain('data: ');
      expect(result).toContain('"type":"item-updated"');
      expect(result).toContain('"rejection_count":1');
      expect(result).toContain('"dependencies":["001"]');
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should format item-deleted event correctly', () => {
      const event: BoardEvent = {
        type: 'item-deleted',
        timestamp: '2026-01-15T13:00:00Z',
        data: {
          itemId: '004',
        },
      };

      const result = formatSSEEvent(event);

      expect(result).toContain('data: ');
      expect(result).toContain('"type":"item-deleted"');
      expect(result).toContain('"itemId":"004"');
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should format board-updated event correctly', () => {
      const board: BoardMetadata = {
        mission: {
          name: 'Test Mission',
          started_at: '2026-01-15T00:00:00Z',
          status: 'active',
        },
        wip_limits: {
          implementing: 2,
          testing: 1,
        },
        phases: {},
        assignments: {},
        agents: {},
        stats: {
          total_items: 10,
          completed: 5,
          in_progress: 3,
          blocked: 1,
          backlog: 1,
        },
        last_updated: '2026-01-15T14:00:00Z',
      };

      const event: BoardEvent = {
        type: 'board-updated',
        timestamp: '2026-01-15T14:00:00Z',
        data: {
          board,
        },
      };

      const result = formatSSEEvent(event);

      expect(result).toContain('data: ');
      expect(result).toContain('"type":"board-updated"');
      expect(result).toContain('"total_items":10');
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should handle complex nested objects', () => {
      const item: WorkItem = {
        id: '005',
        title: 'Complex Item',
        type: 'task',
        status: 'ready',
        assigned_agent: 'Hannibal',
        rejection_count: 0,
        dependencies: ['001', '002', '003'],
        outputs: {
          test: 'src/__tests__/complex.test.ts',
          impl: 'src/lib/complex.ts',
          types: 'src/types/complex.ts',
        },
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T15:00:00Z',
        stage: 'ready',
        content: 'Complex content with "quotes" and special chars',
      };

      const event: BoardEvent = {
        type: 'item-added',
        timestamp: '2026-01-15T15:00:00Z',
        data: {
          itemId: '005',
          item,
        },
      };

      const result = formatSSEEvent(event);

      expect(result).toContain('data: ');
      expect(result).toContain('"assigned_agent":"Hannibal"');
      expect(result).toContain('"dependencies":["001","002","003"]');
      expect(result.endsWith('\n\n')).toBe(true);
    });

    it('should create valid SSE format with proper line breaks', () => {
      const event: BoardEvent = {
        type: 'item-deleted',
        timestamp: '2026-01-15T16:00:00Z',
        data: {
          itemId: '999',
        },
      };

      const result = formatSSEEvent(event);
      const lines = result.split('\n');

      expect(lines[0]).toMatch(/^data: /);
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('');
    });
  });

  describe('parseSSEEvent', () => {
    it('should parse formatted SSE event back to BoardEvent', () => {
      const event: BoardEvent = {
        type: 'item-moved',
        timestamp: '2026-01-15T10:00:00Z',
        data: {
          itemId: '001',
          fromStage: 'ready',
          toStage: 'testing',
        },
      };

      const formatted = formatSSEEvent(event);
      const parsed = parseSSEEvent(formatted);

      expect(parsed.type).toBe('item-moved');
      expect(parsed.timestamp).toBe('2026-01-15T10:00:00Z');
      expect(parsed.data.itemId).toBe('001');
      expect(parsed.data.fromStage).toBe('ready');
      expect(parsed.data.toStage).toBe('testing');
    });

    it('should parse complex WorkItem objects', () => {
      const item: WorkItem = {
        id: '007',
        title: 'Parse Test',
        type: 'bug',
        status: 'done',
        assigned_agent: 'Murdock',
        rejection_count: 2,
        dependencies: ['005', '006'],
        outputs: {
          test: 'test.ts',
          impl: 'impl.ts',
        },
        created_at: '2026-01-15T00:00:00Z',
        updated_at: '2026-01-15T17:00:00Z',
        stage: 'done',
        content: 'Test content',
      };

      const event: BoardEvent = {
        type: 'item-updated',
        timestamp: '2026-01-15T17:00:00Z',
        data: {
          itemId: '007',
          item,
        },
      };

      const formatted = formatSSEEvent(event);
      const parsed = parseSSEEvent(formatted);

      const parsedItem = parsed.data.item as WorkItem | undefined;
      expect(parsedItem?.id).toBe('007');
      expect(parsedItem?.title).toBe('Parse Test');
      expect(parsedItem?.assigned_agent).toBe('Murdock');
      expect(parsedItem?.rejection_count).toBe(2);
      expect(parsedItem?.dependencies).toEqual(['005', '006']);
    });

    it('should handle empty data objects', () => {
      const event: BoardEvent = {
        type: 'board-updated',
        timestamp: '2026-01-15T18:00:00Z',
        data: {},
      };

      const formatted = formatSSEEvent(event);
      const parsed = parseSSEEvent(formatted);

      expect(parsed.type).toBe('board-updated');
      expect(parsed.timestamp).toBe('2026-01-15T18:00:00Z');
      expect(parsed.data).toEqual({});
    });

    it('should throw on invalid SSE format', () => {
      const invalid = 'not a valid sse event';

      expect(() => parseSSEEvent(invalid)).toThrow();
    });

    it('should throw on malformed JSON', () => {
      const malformed = 'data: {invalid json\n\n';

      expect(() => parseSSEEvent(malformed)).toThrow();
    });

    it('should handle SSE messages with only single newline', () => {
      const event: BoardEvent = {
        type: 'item-deleted',
        timestamp: '2026-01-15T19:00:00Z',
        data: {
          itemId: '999',
        },
      };

      const formatted = formatSSEEvent(event);
      const withSingleNewline = formatted.replace('\n\n', '\n');
      const parsed = parseSSEEvent(withSingleNewline);

      expect(parsed.type).toBe('item-deleted');
      expect(parsed.data.itemId).toBe('999');
    });
  });

  describe('Round-trip serialization', () => {
    it('should maintain data integrity through format and parse cycle', () => {
      const board: BoardMetadata = {
        mission: {
          name: 'Round-trip Mission',
          started_at: '2026-01-15T00:00:00Z',
          status: 'active',
        },
        wip_limits: {
          implementing: 3,
        },
        phases: {
          dev: ['briefings', 'ready'],
        },
        assignments: {
          '001': {
            agent: 'Face',
            task_id: '001',
            started_at: '2026-01-15T00:00:00Z',
          },
        },
        agents: {
          Face: {
            status: 'active',
            current_item: '001',
          },
        },
        stats: {
          total_items: 20,
          completed: 10,
          in_progress: 5,
          blocked: 2,
          backlog: 3,
        },
        last_updated: '2026-01-15T20:00:00Z',
      };

      const event: BoardEvent = {
        type: 'board-updated',
        timestamp: '2026-01-15T20:00:00Z',
        data: {
          board,
        },
      };

      const formatted = formatSSEEvent(event);
      const parsed = parseSSEEvent(formatted);

      expect(parsed).toEqual(event);
    });

    it('should handle all event types through round-trip', () => {
      const eventTypes: BoardEventType[] = [
        'item-added',
        'item-moved',
        'item-updated',
        'item-deleted',
        'board-updated',
      ];

      eventTypes.forEach((type) => {
        const event = {
          type,
          timestamp: '2026-01-15T21:00:00Z',
          data: {
            itemId: '999',
          },
        } as unknown as BoardEvent;

        const formatted = formatSSEEvent(event);
        const parsed = parseSSEEvent(formatted);

        expect(parsed.type).toBe(type);
      });
    });
  });
});
