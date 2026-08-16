import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsMobileViewport } from '@/hooks/use-is-mobile-viewport';

/**
 * WI-792 rework (Lynch rejection): the fix for Amy's CRITICAL FLAG
 * (page.tsx never rendered mobile UI at any viewport) shipped with only a
 * throwaway matchMedia-mocked smoke test that B.A. deleted before handoff.
 * These are the permanent tests Lynch required — a real regression guard,
 * not a one-time manual verification.
 *
 * window.matchMedia is not implemented by jsdom, so every test that needs
 * it present must install its own mock and restore it afterward — jsdom
 * throws "not implemented" if production code calls the real thing.
 */

type Listener = (event: MediaQueryListEvent) => void;

/** A minimal but faithful MediaQueryList mock: modern addEventListener API
 * only (matching what the hook actually calls), with a controllable
 * `.matches` and a way to fire a synthetic 'change' event. */
function installMatchMediaMock(initialMatches: boolean) {
  let matches = initialMatches;
  let changeListener: Listener | null = null;
  const removeEventListener = vi.fn();

  const mql = {
    get matches() {
      return matches;
    },
    media: '(max-width: 767px)',
    addEventListener: vi.fn((event: string, listener: Listener) => {
      if (event === 'change') changeListener = listener;
    }),
    removeEventListener,
  };

  const matchMediaFn = vi.fn().mockReturnValue(mql);
  vi.stubGlobal('matchMedia', matchMediaFn);
  // window.matchMedia specifically — the hook checks `window.matchMedia`,
  // and jsdom's `window` is the same global object, but stub explicitly on
  // `window` too so this doesn't depend on that identity holding.
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMediaFn,
  });

  return {
    fireChange: (nextMatches: boolean) => {
      matches = nextMatches;
      if (!changeListener) {
        throw new Error('no change listener was registered — hook did not call addEventListener');
      }
      act(() => {
        changeListener!({ matches: nextMatches } as MediaQueryListEvent);
      });
    },
    removeEventListener,
    matchMediaFn,
  };
}

function uninstallMatchMedia() {
  vi.unstubAllGlobals();
  // @ts-expect-error -- deliberately deleting to restore jsdom's real
  // "matchMedia is not a function" default between tests.
  delete window.matchMedia;
}

describe('useIsMobileViewport', () => {
  afterEach(() => {
    uninstallMatchMedia();
  });

  it('returns false when window.matchMedia is unavailable (SSR / current test-env default)', () => {
    // No mock installed — matches production's real jsdom-default and SSR
    // fail-safe behavior documented in the hook's own comment.
    expect(typeof window.matchMedia).toBe('undefined');

    const { result } = renderHook(() => useIsMobileViewport());

    expect(result.current).toBe(false);
  });

  it('returns true when the media query reports a match on mount', () => {
    installMatchMediaMock(true);

    const { result } = renderHook(() => useIsMobileViewport());

    expect(result.current).toBe(true);
  });

  it('updates when a change event fires (viewport resize/rotate)', () => {
    const { fireChange } = installMatchMediaMock(false);

    const { result } = renderHook(() => useIsMobileViewport());
    expect(result.current).toBe(false);

    fireChange(true);
    expect(result.current).toBe(true);

    fireChange(false);
    expect(result.current).toBe(false);
  });

  it('removes the change listener on unmount', () => {
    const { removeEventListener } = installMatchMediaMock(false);

    const { unmount } = renderHook(() => useIsMobileViewport());
    expect(removeEventListener).not.toHaveBeenCalled();

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
