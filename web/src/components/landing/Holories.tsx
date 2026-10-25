"use client";

import { useLayoutEffect, useRef } from "react";

import { Constellation } from "@/components/landing/Constellation";
import { gsap, ScrollTrigger } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

const STEPS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Gather a small circle",
    body: "Start with the few people you want to hear from.",
  },
  {
    title: "Share the moments you choose",
    body: "Add what you want to keep, on your terms.",
  },
  {
    title: "Look back together",
    body: "Revisit a shared stretch of time as a short story, not a ranking.",
  },
];

/**
 * Holories is a concept under design. Its scoring model is not finalized, so
 * this section shows no score, metric, or ranking. The steps are scroll-linked:
 * each step lights one node of the constellation as it reaches the reading
 * line. Reduced motion keeps every node lit and skips the scroll link.
 */
export function Holories() {
  const scope = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = scope.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>(".holories__steps li").forEach((step, index) => {
        const node = root.querySelector<SVGCircleElement>(`.holories__figure [data-node="${index}"]`);
        if (!node) {
          return;
        }
        gsap.fromTo(
          node,
          { opacity: 0.25, scale: 0.6 },
          {
            opacity: 1,
            scale: 1,
            ease: "none",
            scrollTrigger: { trigger: step, start: "top 75%", end: "top 35%", scrub: true },
          },
        );
      });
      ScrollTrigger.refresh();
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section className="section" id="holories" aria-labelledby="holories-title" ref={scope}>
      <div className="section__inner holories">
        <div className="holories__figure" aria-hidden="true">
          <Constellation />
        </div>
        <div>
          <p className="eyebrow">Concept</p>
          <h2 className="section__title" id="holories-title">
            Holories
          </h2>
          <p className="lede-text">A way to look back on time spent together, in your own words.</p>
          <ol className="holories__steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="holories__index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
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
