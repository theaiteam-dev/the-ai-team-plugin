/**
 * Tests for WI-946: Board surfaces finding provenance on work items.
 *
 * Renders WI-936's learning fields (severity, attributedAgent, fingerprint)
 * on the board. This item only renders what WI-936 persists and the items
 * API already returns — no new data plumbing is tested here (the WorkItem
 * type and the API-transform mapping layer are extended incidentally to
 * make the component compile; this file tests the COMPONENTS in isolation
 * with a mocked `item` prop, the same convention work-item-card.test.tsx
 * and item-detail-modal.test.tsx already use).
 *
 * FIELD NAMES (Murdock's contract choice, since neither file is named
 * elsewhere): `WorkItem.severity` and `WorkItem.fingerprint` (single words,
 * no case ambiguity), `WorkItem.attributed_agent` — snake_case, mirroring
 * the EXISTING `assigned_agent`/`rejection_count` convention on WorkItem
 * (confirmed via src/lib/api-transform.ts:63-64, which already maps the
 * API's camelCase `assignedAgent`/`rejectionCount` to WorkItem's snake_case
 * fields — the same mapping pattern extends naturally to
 * severity/attributedAgent/fingerprint).
 *
 * VISUAL-DISTINCTNESS DESIGN NOTE (test-writing skill Ban #3 — no utility-
 * class assertions): "visually distinguishable by severity level" (AC1) is
 * tested the same way this file's existing type-badge tests already treat
 * "distinguishable by type" — by asserting the severity VALUE renders as
 * visible text (getByText), one test per value, exactly like the existing
 * feature/bug/enhancement/task badge tests. No Tailwind class string is
 * asserted anywhere in this file. A `data-severity` attribute (a semantic
 * data hook, not a styling class — mirrors the existing `data-status-dot`
 * attribute already used in work-item-card.tsx) gives B.A. a clean CSS seam
 * without this file pinning what that CSS actually is.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkItemCard } from '../components/work-item-card';
import { ItemDetailModal } from '../components/item-detail-modal';
import type { WorkItem } from '../types';

const createCardWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: '013',
  title: 'Payment Processing Module',
  type: 'feature',
  status: 'ready',
  assigned_agent: undefined,
  rejection_count: 0,
  dependencies: [],
  outputs: {},
  created_at: '2026-01-15T00:00:00Z',
  updated_at: '2026-01-15T00:00:00Z',
  stage: 'briefings',
  content: 'Test content',
  ...overrides,
});

const createModalWorkItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: '007',
  title: 'Auth Service Implementation',
  type: 'feature',
  status: 'implementing',
  assigned_agent: 'B.A.',
  rejection_count: 0,
  dependencies: ['001', '003'],
  outputs: {
    impl: 'src/services/auth.ts',
    test: 'src/__tests__/auth.test.ts',
    types: 'src/types/auth.ts',
  },
  created_at: '2026-01-15T10:30:00Z',
  updated_at: '2026-01-15T14:20:00Z',
  stage: 'implementing',
  content: '# Implementation Notes\n\nFull markdown content here...',
  ...overrides,
});

const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low'] as const;

// =============================================================================
// AC1: a work item carrying a severity displays it on its board card,
// visually distinguishable by severity level.
// =============================================================================

describe('WorkItemCard — severity badge (AC1)', () => {
  it.each(SEVERITY_VALUES)('displays the %s severity as visible text', (severity) => {
    const item = createCardWorkItem({ severity });
    render(<WorkItemCard item={item} />);
    expect(screen.getByText(severity)).toBeInTheDocument();
  });

  it('renders the severity in an identifiable, semantically-tagged element', () => {
    const item = createCardWorkItem({ severity: 'critical' });
    render(<WorkItemCard item={item} />);
    const badge = screen.getByTestId('severity-badge');
    expect(badge).toHaveTextContent('critical');
  });

  it.each(SEVERITY_VALUES)('exposes the %s severity via a data-severity attribute (a CSS hook, not a class assertion)', (severity) => {
    const item = createCardWorkItem({ severity });
    render(<WorkItemCard item={item} />);
    const badge = screen.getByTestId('severity-badge');
    expect(badge.getAttribute('data-severity')).toBe(severity);
  });
});

// =============================================================================
// AC2: a work item carrying an attributed agent and a fingerprint shows
// both in its detail view, with the fingerprint shown as the slug it was
// matched or minted as (verbatim, not reformatted).
// =============================================================================

describe('ItemDetailModal — attributed agent and fingerprint (AC2)', () => {
  it('shows the attributed agent in the detail view', () => {
    const item = createModalWorkItem({ attributed_agent: 'ba' });
    render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);
    expect(screen.getByTestId('attributed-agent')).toHaveTextContent('ba');
  });

  it('shows the fingerprint in the detail view as the exact slug, verbatim', () => {
    const item = createModalWorkItem({ fingerprint: 'missing-error-handling' });
    render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);
    expect(screen.getByTestId('fingerprint')).toHaveTextContent('missing-error-handling');
  });

  it('shows both together when an item carries both', () => {
    const item = createModalWorkItem({
      attributed_agent: 'lynch',
      fingerprint: 'shallow-review',
    });
    render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);
    expect(screen.getByTestId('attributed-agent')).toHaveTextContent('lynch');
    expect(screen.getByTestId('fingerprint')).toHaveTextContent('shallow-review');
  });

  it('does not reformat the fingerprint slug (e.g. title-casing or replacing hyphens)', () => {
    const item = createModalWorkItem({ fingerprint: 'race-condition-in-concurrent-writes' });
    render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);
    // Exact-match text content, not a substring/loose match — proves the
    // component doesn't humanize or truncate the slug.
    expect(screen.getByTestId('fingerprint').textContent).toBe('race-condition-in-concurrent-writes');
  });
});

// =============================================================================
// AC3: an item with no provenance fields renders exactly as it does today —
// no empty badge, no placeholder, no layout shift.
// =============================================================================

describe('no provenance fields renders exactly as today (AC3)', () => {
  it('WorkItemCard renders no severity badge when severity is absent', () => {
    const item = createCardWorkItem();
    render(<WorkItemCard item={item} />);
    expect(screen.queryByTestId('severity-badge')).not.toBeInTheDocument();
  });

  it('WorkItemCard still renders its pre-existing fields unaffected (regression)', () => {
    const item = createCardWorkItem({ title: 'Plain feature, no provenance' });
    render(<WorkItemCard item={item} />);
    expect(screen.getByText('Plain feature, no provenance')).toBeInTheDocument();
    expect(screen.getByText('feature')).toBeInTheDocument();
    expect(screen.queryByTestId('severity-badge')).not.toBeInTheDocument();
  });

  it('ItemDetailModal renders no attributed-agent row when attributed_agent is absent', () => {
    const item = createModalWorkItem();
    render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);
    expect(screen.queryByTestId('attributed-agent')).not.toBeInTheDocument();
  });

  it('ItemDetailModal renders no fingerprint row when fingerprint is absent', () => {
    const item = createModalWorkItem();
    render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);
    expect(screen.queryByTestId('fingerprint')).not.toBeInTheDocument();
  });

  it('ItemDetailModal still renders its pre-existing fields unaffected (regression)', () => {
    const item = createModalWorkItem();
    render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);
    expect(screen.getByText('Auth Service Implementation')).toBeInTheDocument();
    expect(screen.getByText('Assigned to B.A.')).toBeInTheDocument();
  });
});

// =============================================================================
// AC4: provenance fields are presented as text content, so a card carrying
// them stays readable at the board's existing card width.
// =============================================================================

describe('provenance fields are plain text content, not images/icons requiring extra width (AC4)', () => {
  it('the severity badge is discoverable via getByText — proves it is real text content, not an image or icon-only element', () => {
    // getByText only matches actual text nodes; an <img> or icon-only
    // element with no text would fail this query even if visually present
    // — this is the behavioral proxy for "presented as text content" that
    // jsdom (no real layout engine) can actually verify.
    const item = createCardWorkItem({ severity: 'high' });
    render(<WorkItemCard item={item} />);
    expect(screen.getByText('high').tagName.toLowerCase()).not.toBe('img');
  });

  it('the fingerprint value in the detail view is discoverable via getByTestId text content, not an image', () => {
    const item = createModalWorkItem({ fingerprint: 'fp-readable' });
    render(<ItemDetailModal isOpen={true} onClose={() => {}} item={item} />);
    const el = screen.getByTestId('fingerprint');
    expect(el.tagName.toLowerCase()).not.toBe('img');
    expect(el.textContent).toBeTruthy();
  });
});
