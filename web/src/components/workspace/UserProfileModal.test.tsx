// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as actions from "@/app/app/actions";
import { UserProfileModal } from "./UserProfileModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("UserProfileModal Component", () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockUser = {
    id: "uuid-1234",
    username: "aanya",
    displayName: "Aanya Sharma",
    bio: "Exploring slow technology",
    avatarUrl: null,
    isFollowing: false,
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders accessible dialog semantics and no inline styles", () => {
    const html = renderToStaticMarkup(
      <UserProfileModal user={mockUser} isOpen={true} onClose={vi.fn()} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="profile-modal-name"');
    expect(html).not.toMatch(/\sstyle="/);
  });

  it("displays public profile information and isolates private data", () => {
    const html = renderToStaticMarkup(
      <UserProfileModal user={mockUser} isOpen={true} onClose={vi.fn()} />,
    );
    expect(html).toContain("Aanya Sharma");
    expect(html).toContain("@aanya");
    expect(html).toContain("Exploring slow technology");
    // Ensure email is completely absent
    expect(html).not.toContain("email");
    expect(html).not.toContain("@example.com");
  });

  it("dismisses on Escape key", () => {
    const handleClose = vi.fn();
    act(() => {
      root.render(
        <UserProfileModal user={mockUser} isOpen={true} onClose={handleClose} />,
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
        <UserProfileModal user={mockUser} isOpen={true} onClose={handleClose} />,
      );
    });

    act(() => {
      window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("toggles follow state and prevents duplicate clicks while pending", async () => {
    let resolveFollow: (val: { ok: true }) => void;
    const followPromise = new Promise<{ ok: true }>((resolve) => {
      resolveFollow = resolve;
    });

    const followSpy = vi
      .spyOn(actions, "followUserAction")
      .mockImplementation(() => followPromise);

    act(() => {
      root.render(
        <UserProfileModal user={mockUser} isOpen={true} onClose={vi.fn()} />,
      );
    });

    const button = container.querySelector("button.btn-follow") as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.textContent).toContain("Follow");

    // Click Follow
    act(() => {
      button.click();
    });

    // Should optimistically change text and be disabled while pending
    expect(button.disabled).toBe(true);
    expect(followSpy).toHaveBeenCalledTimes(1);
    expect(followSpy).toHaveBeenCalledWith("aanya");

    // Second click while pending must be ignored
    act(() => {
      button.click();
    });
    expect(followSpy).toHaveBeenCalledTimes(1);

    // Resolve follow mutation
    await act(async () => {
      resolveFollow!({ ok: true });
    });

    expect(button.disabled).toBe(false);
    expect(button.textContent).toContain("Following");
  });

  it("rolls back optimistic follow update on failure", async () => {
    vi.spyOn(actions, "followUserAction").mockResolvedValue({
      ok: false,
      message: "Too many follow requests. Wait a minute and try again.",
    });

    act(() => {
      root.render(
        <UserProfileModal user={mockUser} isOpen={true} onClose={vi.fn()} />,
      );
    });

    const button = container.querySelector("button.btn-follow") as HTMLButtonElement;

    await act(async () => {
      button.click();
    });

    // Rolled back to Follow
    expect(button.textContent).toContain("Follow");
    expect(container.textContent).toContain("Too many follow requests");
  });
});
