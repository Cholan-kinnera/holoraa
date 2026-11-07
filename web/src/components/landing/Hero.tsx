"use client";

import { useLayoutEffect, useRef } from "react";

import { Constellation } from "@/components/landing/Constellation";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { gsap } from "@/lib/gsap";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * The hero is fully readable in server-rendered markup. When JavaScript runs,
 * a GSAP timeline plays the entrance. The timeline's starting states are set
 * before the first paint, so there is no flash of hidden content. Reduced
 * motion skips the timeline entirely.
 */
export function Hero() {
  const scope = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = scope.current;
    if (!root || prefersReducedMotion()) {
      return;
    }

    const ctx = gsap.context(() => {
      const timeline = gsap.timeline({ defaults: { ease: "power3.out" } });
      timeline
        .from(".hero__line > span", { yPercent: 110, duration: 1.1, stagger: 0.12 })
        .from(".hero__copy > *", { opacity: 0, y: 16, duration: 0.8, stagger: 0.08 }, "-=0.75")
        .from(".constellation__node", { scale: 0, opacity: 0, duration: 0.6, stagger: 0.08 }, "-=0.9")
        .from(".constellation__edge", { strokeDashoffset: 1, duration: 1.2, stagger: 0.08 }, "-=0.8");
    }, root);

    return () => ctx.revert();
  }, []);

  return (
    <section className="hero" ref={scope} aria-labelledby="hero-title">
      <div className="hero__inner">
        <div className="hero__copy">
          <p className="eyebrow">A calm social space</p>
          <h1 className="hero__title" id="hero-title">
            <span className="hero__line">
              <span>Talk, share,</span>
            </span>
            <span className="hero__line hero__line--accent">
              <span>and hang out</span>
            </span>
            <span className="hero__line">
              <span>with the people who matter.</span>
            </span>
          </h1>
          <p className="lede-text">
            Holoraa is one minimal space to chat, hang out, and share. Private by default, with no ads and no feed
            built to hold your attention.
          </p>
          <div className="hero__actions">
            <ButtonLink href="#principles">Read the principles</ButtonLink>
            <ButtonLink href="#holories" variant="ghost">
              Meet Holories
            </ButtonLink>
          </div>
          <p className="faint hero__note">
            Holoraa is in early build. Sign-in is in development and not available yet. The system status page shows what runs today.
          </p>
        </div>
        <div className="hero__visual">
          <Constellation />
        </div>
      </div>
    </section>
  );
}
