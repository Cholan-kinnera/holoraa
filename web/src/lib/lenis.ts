'use client';

import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap, ScrollTrigger } from './gsap';

/**
 * Initializes Lenis smooth scrolling coupled with GSAP ScrollTrigger ticker.
 * Gracefully disables on touch devices, if prefers-reduced-motion is active,
 * or when disabled (e.g. inside the interactive workspace).
 */
export function useLenis(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined' || typeof window.ResizeObserver === 'undefined') return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    // Ensure GSAP lag smoothing is at safe defaults (500ms max lag, 33ms target delta)
    // to prevent frame backlog cascades and compositor stalls during heavy loads.
    gsap.ticker.lagSmoothing(500, 33);

    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 0.95,
      touchMultiplier: 1.5,
      autoRaf: false, // Ensure Lenis is driven strictly by GSAP ticker, avoiding dual RAF loops
    });

    const handleScroll = () => {
      ScrollTrigger.update();
    };

    lenis.on('scroll', handleScroll);

    // Drive Lenis from GSAP ticker with frame timestamp in ms.
    // Skip calculations when document is inactive/hidden to conserve GPU/CPU cycles.
    const tickerCallback = (time: number) => {
      if (typeof document !== 'undefined' && document.hidden) return;
      lenis.raf(time * 1000);
    };

    gsap.ticker.add(tickerCallback);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        lenis.stop();
      } else {
        lenis.start();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      gsap.ticker.remove(tickerCallback);
      // Restore default lag smoothing on unmount
      gsap.ticker.lagSmoothing(500, 33);
      lenis.off('scroll', handleScroll);
      lenis.destroy();
    };
  }, [enabled]);
}
