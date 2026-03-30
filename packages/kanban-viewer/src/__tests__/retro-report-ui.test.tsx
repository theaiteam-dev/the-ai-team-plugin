import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RetroReport } from '@/components/RetroReport';

/**
 * Tests for RetroReport UI component (WI-021).
 *
 * RetroReport displays the retrospective report from a mission detail view.
 * - Shows nothing when retroReport is null/undefined
 * - Renders markdown as HTML when retroReport is present
 * - Preserves headings, lists, code blocks, and emphasis
 */

describe('RetroReport', () => {
  it('renders nothing when retroReport is null', () => {
    const { container } = render(<RetroReport retroReport={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when retroReport is undefined', () => {
    const { container } = render(<RetroReport retroReport={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders section with content when retroReport is non-null', () => {
    render(<RetroReport retroReport="## Retro\n\nGreat sprint." />);
    // Section should be present in the DOM
    expect(screen.getByText(/retro/i)).toBeDefined();
  });

  it('renders markdown headings as HTML heading elements', () => {
    render(<RetroReport retroReport="## What went well\n\nGood things happened." />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toBeDefined();
    expect(heading.textContent).toContain('What went well');
  });

  it('renders markdown lists as HTML list elements', () => {
    render(<RetroReport retroReport={"## Retro\n\n- Item one\n- Item two\n- Item three"} />);
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(3);
  });

  it('renders markdown code blocks as code elements', () => {
    render(<RetroReport retroReport={"## Retro\n\n```\nconst x = 1;\n```"} />);
    const codeBlock = document.querySelector('code');
    expect(codeBlock).not.toBeNull();
  });

  it('does not convert literal \\n sequences — they should render as-is', () => {
    // A report that intentionally contains the two-character literal sequence \n
    // (e.g. an inline code example). The component must NOT replace these with
    // real newlines; normalizing double-escaping is the storage layer's job.
    render(<RetroReport retroReport={'Example: \\n means newline'} />);
    expect(screen.getByText(/\\n means newline/)).toBeDefined();
  });
});
