import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LandingPage from "@/app/page";

// Rendered once: the page is server-rendered markup, and these checks read it as
// a browser without JavaScript would receive it.
const html = renderToStaticMarkup(<LandingPage />);

describe("landing page markup", () => {
  it("has no inline style attributes, so the nonce-only style-src policy holds", () => {
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("has exactly one level-one heading inside the main landmark", () => {
    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/<main id="main"[^>]*>[\s\S]*<h1[\s>]/);
  });

  it("starts with a skip link to the main landmark", () => {
    expect(html).toContain('<a class="skip-link" href="#main">Skip to content</a>');
  });

  it("labels the product preview as illustrative, not a released interface", () => {
    expect(html).toContain("Illustrative preview of a conversation view.");
    expect(html).toContain("It is not a screenshot of a released interface.");
  });

  it("presents Holories as a concept with no finalized score", () => {
    expect(html).toContain("Holories is a concept under design.");
    expect(html).toContain("Its scoring model is not finalized");
  });

  it("does not invent social proof: no testimonials, logos, or user counts", () => {
    expect(html).not.toMatch(/testimonial|trusted by|users love|\d[\d,]*\+? (users|members|people)/i);
  });

  it("does not mention competitors", () => {
    expect(html).not.toMatch(/discord|slack|whatsapp|telegram|instagram|facebook|tiktok|signal/i);
  });

  it("points every in-page hash link at an element that exists", () => {
    const hashes = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    expect(hashes.length).toBeGreaterThan(0);
    for (const id of new Set(hashes)) {
      expect(html, `missing target #${id}`).toContain(`id="${id}"`);
    }
  });

  it("links to the status page and the principles, and no link is empty", () => {
    expect(html).toContain('href="/status"');
    expect(html).toContain('href="#principles"');
    expect(html).not.toMatch(/href=""|href="#"/);
  });
});
