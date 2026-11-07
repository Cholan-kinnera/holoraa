"use client";

import { useLayoutEffect, useRef } from "react";
import { MemoryCanvas } from "@/components/landing/MemoryCanvas";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Gather a small circle",
    body: "Start with the few people you actually want to hear from. No algorithms dictating who sees your moments.",
  },
  {
    title: "Share real moments as they happen",
    body: "Add analog photographs, voice notes, and thoughts on your terms. Built for genuine memory, never for vanity metrics.",
  },
  {
    title: "Look back together",
    body: "Revisit a shared stretch of time as an intimate short story and journal—not a competitive ranking or streak counter.",
  },
];

/**
 * Holories is a concept under design. Its scoring model is not finalized, so
 * this section shows no score, metric, or ranking. Steps are scroll-linked:
 * as you read, the shared-memory canvas reflects the quiet warmth of time spent together.
 * Reduced motion keeps everything calm and skips the scroll link.
 */
export function Holories() {
  const scope = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = scope.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.fromTo(
        ".holories__canvas-container",
        { opacity: 0.85, y: 20 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          ease: "power2.out",
          scrollTrigger: {
            trigger: root,
            start: "top 75%",
          },
        }
      );

      gsap.utils.toArray<HTMLElement>(".holories__steps li").forEach((step) => {
        gsap.fromTo(
          step,
          { opacity: 0.4, x: -10 },
          {
            opacity: 1,
            x: 0,
            duration: 0.6,
            ease: "power2.out",
            scrollTrigger: {
              trigger: step,
              start: "top 80%",
              end: "top 40%",
              scrub: true,
            },
          }
        );
      });
      ScrollTrigger.refresh();
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section className="section" id="holories" aria-labelledby="holories-title" ref={scope}>
      <div className="section__inner holories">
        <div className="holories__canvas-container">
          <MemoryCanvas />
        </div>
        <div>
          <p className="eyebrow">Concept</p>
          <h2 className="section__title" id="holories-title">
            Holories
          </h2>
          <p className="lede-text">A way to look back on time spent together, in your own words.</p>
          <ol className="holories__steps">
            {STEPS.map((step, index) => (
              <li key={step.title} className="holories__step-card">
                <span className="holories__index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="holories__step-content">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="concept-note glass">
            Holories is a concept under design. Its scoring model is not finalized, and nothing on this page is a score,
            a metric, or a promise.
          </p>
        </div>
      </div>
    </section>
  );
}
