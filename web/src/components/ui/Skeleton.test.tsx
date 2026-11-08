// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import {
  ProfileModalSkeleton,
  SearchResultsSkeleton,
  Skeleton,
  SkeletonAvatar,
  SkeletonText,
} from "./Skeleton";

describe("Skeleton Components", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders base skeleton with aria-hidden", () => {
    act(() => {
      root.render(<Skeleton className="w-10 h-10" />);
    });
    const el = container.querySelector(".skeleton");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("aria-hidden")).toBe("true");
    expect(el?.className).toContain("w-10 h-10");
  });

  it("renders SkeletonAvatar with correct size class", () => {
    act(() => {
      root.render(<SkeletonAvatar size="2xl" />);
    });
    const el = container.querySelector(".skeleton--circle");
    expect(el).not.toBeNull();
    expect(el?.className).toContain("w-14 h-14");
  });

  it("renders single and multiline SkeletonText", () => {
    act(() => {
      root.render(<SkeletonText lines={3} />);
    });
    const lines = container.querySelectorAll(".skeleton--text");
    expect(lines.length).toBe(3);
    expect(lines[2]?.className).toContain("w-2/3");
  });

  it("renders SearchResultsSkeleton with aria-busy", () => {
    act(() => {
      root.render(<SearchResultsSkeleton />);
    });
    const el = container.querySelector("[aria-busy='true']");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("aria-label")).toBe("Loading search results");
    const rows = container.querySelectorAll(".hairline-border");
    expect(rows.length).toBe(3);
  });

  it("renders ProfileModalSkeleton with aria-busy", () => {
    act(() => {
      root.render(<ProfileModalSkeleton />);
    });
    const el = container.querySelector("[aria-busy='true']");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("aria-label")).toBe("Loading profile");
  });
});
