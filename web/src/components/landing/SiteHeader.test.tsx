// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { prefersReducedMotion } from "@/lib/motion";

import { SiteHeader } from "./SiteHeader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<SiteHeader />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function menuToggle(): HTMLButtonElement {
  const toggle = container.querySelector<HTMLButtonElement>(".menu-toggle");
  if (!toggle) {
    throw new Error("menu toggle not rendered");
  }
  return toggle;
}

describe("SiteHeader mobile menu", () => {
  it("starts closed, with the toggle reporting that state", () => {
    expect(menuToggle().getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".mobile-menu")).toBeNull();
  });

  it("opens on click and ties the toggle to the panel", () => {
    act(() => menuToggle().click());

    expect(menuToggle().getAttribute("aria-expanded")).toBe("true");
    const panel = container.querySelector<HTMLElement>(".mobile-menu");
    expect(panel).not.toBeNull();
    expect(menuToggle().getAttribute("aria-controls")).toBe(panel?.id);
    expect(menuToggle().getAttribute("aria-label")).toBe("Close menu");
  });

  it("closes on Escape and returns focus to the toggle", () => {
    act(() => menuToggle().click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(container.querySelector(".mobile-menu")).toBeNull();
    expect(menuToggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menuToggle());
  });

  it("ignores keys other than Escape", () => {
    act(() => menuToggle().click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });

    expect(container.querySelector(".mobile-menu")).not.toBeNull();
  });

  it("closes when a menu link is chosen", () => {
    act(() => menuToggle().click());
    const link = container.querySelector<HTMLAnchorElement>(".mobile-menu a");
    act(() => link?.click());

    expect(container.querySelector(".mobile-menu")).toBeNull();
  });
});

describe("prefersReducedMotion", () => {
  it("reports true when the reduce media query matches", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

    expect(prefersReducedMotion()).toBe(true);
  });

  it("reports false when the user has not asked for less motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));

    expect(prefersReducedMotion()).toBe(false);
  });
});
