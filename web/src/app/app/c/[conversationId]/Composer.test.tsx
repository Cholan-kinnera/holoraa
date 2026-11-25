// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Composer } from "./Composer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Composer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onSend: ReturnType<typeof vi.fn<(content: string) => void>>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onSend = vi.fn<(content: string) => void>();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (disabledReason: string | null = null) =>
    act(() => root.render(<Composer peerName="Bob" disabledReason={disabledReason} onSend={onSend} />));
  const input = () => container.querySelector("textarea")!;
  const sendButton = () => container.querySelector<HTMLButtonElement>("button[type=submit]")!;

  function type(value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input(), value);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function press(init: KeyboardEventInit) {
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init });
    act(() => {
      input().dispatchEvent(event);
    });
    return event;
  }

  it("sends on Enter and clears the input", async () => {
    await render();
    type("hello");
    const event = press({});
    expect(event.defaultPrevented).toBe(true);
    expect(onSend).toHaveBeenCalledWith("hello");
    expect(input().value).toBe("");
  });

  it("inserts a newline on Shift+Enter", async () => {
    await render();
    type("hello");
    const event = press({ shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("never sends while an input method is composing", async () => {
    await render();
    type("こんにちは");
    expect(press({ isComposing: true }).defaultPrevented).toBe(false);
    expect(press({ keyCode: 229 }).defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("leaves Enter as a newline on touch devices", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q === "(pointer: coarse)" }));
    await render();
    type("hello");
    expect(press({}).defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();

    act(() => sendButton().click());
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("ignores blank input", async () => {
    await render();
    type("   \n ");
    press({});
    expect(onSend).not.toHaveBeenCalled();
    expect(sendButton().disabled).toBe(true);
  });

  it("counts down near the limit and blocks sending over it", async () => {
    await render();
    type("a".repeat(3600));
    expect(container.textContent).toContain("400 left");
    type("a".repeat(4001));
    expect(container.textContent).toContain("1 over the limit");
    expect(sendButton().disabled).toBe(true);
    press({});
    expect(onSend).not.toHaveBeenCalled();
  });

  it("is locked with the reason shown when sending is not allowed", async () => {
    await render("Accept the request to reply to Bob.");
    expect(input().disabled).toBe(true);
    expect(sendButton().disabled).toBe(true);
    expect(container.textContent).toContain("Accept the request to reply to Bob.");
  });
});
