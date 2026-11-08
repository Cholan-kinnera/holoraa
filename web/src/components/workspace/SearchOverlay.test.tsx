// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as actions from "@/app/app/actions";
import { SearchOverlay } from "./SearchOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SearchOverlay Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders with accessible dialog attributes and no inline styles", () => {
    const html = renderToStaticMarkup(
      <SearchOverlay isOpen={true} onClose={vi.fn()} onSelectUser={vi.fn()} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="search-modal-title"');
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("does not render when isOpen is false", () => {
    act(() => {
      root.render(
        <SearchOverlay isOpen={false} onClose={vi.fn()} onSelectUser={vi.fn()} />,
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses on Escape key press", () => {
    const handleClose = vi.fn();
    act(() => {
      root.render(
        <SearchOverlay isOpen={true} onClose={handleClose} onSelectUser={vi.fn()} />,
      );
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("dismisses on outside pointerdown", () => {
    const handleClose = vi.fn();
    act(() => {
      root.render(
        <SearchOverlay isOpen={true} onClose={handleClose} onSelectUser={vi.fn()} />,
      );
    });

    const outsideTarget = document.createElement("div");
    document.body.append(outsideTarget);

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
    outsideTarget.remove();
  });

  it("debounces user search input by 250ms", async () => {
    const mockUsers = [
      {
        id: "u-1",
        username: "kavi",
        displayName: "Kavitha",
        bio: "Designing calm spaces",
        avatarUrl: null,
        isFollowing: false,
      },
    ];
    const searchSpy = vi.spyOn(actions, "searchUsersAction").mockResolvedValue({
      ok: true,
      users: mockUsers,
    });

    act(() => {
      root.render(
        <SearchOverlay isOpen={true} onClose={vi.fn()} onSelectUser={vi.fn()} />,
      );
    });

    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    // Type query
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(input, "kav");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Before 250ms: not called yet
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(searchSpy).not.toHaveBeenCalled();

    // Advance remaining debounce time
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(searchSpy).toHaveBeenCalledWith("kav", 15);
  });

  it("navigates candidates with arrow keys and selects with Enter", async () => {
    const mockUsers = [
      { id: "u-1", username: "user_a", displayName: "User A", bio: null, avatarUrl: null, isFollowing: false },
      { id: "u-2", username: "user_b", displayName: "User B", bio: null, avatarUrl: null, isFollowing: false },
    ];
    vi.spyOn(actions, "searchUsersAction").mockResolvedValue({
      ok: true,
      users: mockUsers,
    });
    const selectSpy = vi.fn();

    act(() => {
      root.render(
        <SearchOverlay isOpen={true} onClose={vi.fn()} onSelectUser={selectSpy} />,
      );
    });

    const input = container.querySelector("input")!;
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeSetter?.call(input, "user");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    // Arrow down moves to second candidate
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    });

    // Press Enter to select
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    });

    expect(selectSpy).toHaveBeenCalledWith(mockUsers[1]);
  });
});
