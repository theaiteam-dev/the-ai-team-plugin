"use client";

import { useEffect, useState } from "react";

/**
 * Matches Tailwind's default `md` breakpoint (768px) — the same threshold
 * ResponsiveBoard's `md:hidden` / `hidden md:flex` classes already use, so
 * the JS-driven layout switch this hook powers stays in sync with any
 * Tailwind responsive classes elsewhere in the tree.
 */
const MOBILE_BREAKPOINT_QUERY = "(max-width: 767px)";

/**
 * Reads the current match once. SSR- and jsdom-safe: returns `false`
 * (desktop) whenever `window.matchMedia` is unavailable. Used as the lazy
 * useState initializer so the value is correct on first render WITHOUT a
 * synchronous setState inside the effect (which triggers cascading renders
 * and is flagged by react-hooks lint).
 */
function readIsMobile(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches;
}

/**
 * Detects whether the viewport is currently at or below the mobile
 * breakpoint, via a live matchMedia listener (not just a one-time read) so
 * resizing or rotating the device updates the result.
 *
 * Defaults to `false` (desktop) whenever `window.matchMedia` is
 * unavailable — during server-side rendering, and in the current test
 * environment (jsdom does not implement matchMedia). This is a deliberate
 * fail-safe: existing desktop-oriented tests are unaffected by this hook
 * without needing any matchMedia mock, since jsdom's default viewport
 * (innerWidth 1024) is desktop-sized anyway.
 */
export function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(readIsMobile);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(MOBILE_BREAKPOINT_QUERY);

    // The initial value comes from the lazy useState initializer above; this
    // effect only SUBSCRIBES to later changes, so there is no synchronous
    // setState in the effect body.
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    // Safari < 14 (and other older WebKit builds) shipped MediaQueryList
    // without addEventListener/removeEventListener — only the deprecated
    // addListener/removeListener pair. Feature-detect the modern API and
    // fall back, keeping subscribe and cleanup symmetric so the listener is
    // always removed through the same API it was added with.
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", handleChange);
      return () => mediaQueryList.removeEventListener("change", handleChange);
    }

    mediaQueryList.addListener(handleChange);
    return () => mediaQueryList.removeListener(handleChange);
  }, []);

  return isMobile;
}
