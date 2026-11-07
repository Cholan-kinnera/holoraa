// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ShellFrame } from "./ShellFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <ShellFrame sidebar={<p>Side</p>} account={<span>Account</span>}>
        <p>Main</p>
      </ShellFrame>,
    );
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function navToggle(): HTMLButtonElement {
  const toggle = container.querySelector<HTMLButtonElement>(".menu-toggle");
  if (!toggle) {
    throw new Error("navigation toggle not rendered");
  }
  return toggle;
}

describe("ShellFrame navigation drawer", () => {
  it("opens the conversations drawer and marks the shell", () => {
    expect(navToggle().getAttribute("aria-expanded")).toBe("false");
    act(() => navToggle().click());
    expect(navToggle().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".shell--nav-open")).not.toBeNull();
    expect(navToggle().getAttribute("aria-controls")).toBe(container.querySelector("aside")?.id);
  });

  it("closes on Escape and returns focus to the toggle", () => {
    act(() => navToggle().click());
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector(".shell--nav-open")).toBeNull();
    expect(document.activeElement).toBe(navToggle());
  });

  it("closes from the scrim", () => {
    act(() => navToggle().click());
    const scrim = container.querySelector<HTMLButtonElement>(".shell__scrim");
    act(() => scrim?.click());
    expect(container.querySelector(".shell--nav-open")).toBeNull();
  });
});
