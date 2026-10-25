"use client";

import { useSyncExternalStore } from "react";

/**
 * Animation ownership rules used across the landing page:
 *
 * - GSAP owns transforms and opacity of the hero and story choreography.
 * - Motion owns the mobile menu panel and button press feedback.
 * - CSS owns glass surfaces, ambient light, and focus rings.
 * - Nothing is hidden by default in server-rendered markup. Entrance
 *   animations start only once the browser has run JavaScript.
 */

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

/**
 * True when the user asks for reduced motion. Call it only in the browser
 * (inside an effect). GSAP setup reads it once, because it skips the setup.
 */
export function prefersReducedMotion(): boolean {
  return snapshot();
}

/** True when the user asks for reduced motion. Server-rendered as false. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
