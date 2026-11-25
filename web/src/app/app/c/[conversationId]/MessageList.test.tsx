// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MessageDeliveryStatus, UiMessage } from "@/lib/messaging/state";

import { MessageList } from "./MessageList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = "me";
const BOB = "bob";

let n = 0;
function msg(senderId: string, minute: number, status: MessageDeliveryStatus = "sent"): UiMessage {
  n += 1;
  const at = new Date();
  at.setHours(9, minute, 0, 0);
  return {
    id: `m${n}`,
    conversationId: "c",
    senderId,
    clientMessageId: `c${n}`,
    content: `message ${n}`,
    sequenceNum: n,
    createdAt: at.toISOString(),
    deliveryStatus: status,
  };
}

describe("MessageList", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (messages: UiMessage[]) =>
    act(() => root.render(<MessageList messages={messages} currentUserId={ME} />));

  it("renders a day separator and groups bubbles by sender", async () => {
    await render([msg(BOB, 0), msg(BOB, 1), msg(ME, 2, "read")]);

    expect(container.querySelector(".day-sep")?.textContent).toBe("Today");
    const groups = container.querySelectorAll(".msg-group");
    expect(groups).toHaveLength(2);
    expect(groups[0]?.querySelectorAll(".msg")).toHaveLength(2);
    expect(groups[1]?.classList.contains("msg-group--mine")).toBe(true);
  });

  it("shows the delivery status only on my groups, for the latest message", async () => {
    await render([msg(BOB, 0), msg(ME, 1, "read"), msg(ME, 2, "delivered")]);

    const [theirs, mine] = container.querySelectorAll(".msg-group");
    expect(theirs?.querySelector(".msg-status")).toBeNull();
    expect(mine?.querySelector(".msg-status")?.getAttribute("aria-label")).toBe("Delivered");
    expect(mine?.querySelector("time")?.getAttribute("dateTime")).toBeTruthy();
  });

  it.each([
    ["sending", "Sending"],
    ["sent", "Sent"],
    ["delivered", "Delivered"],
    ["read", "Read"],
  ] as const)("labels the %s tick", async (status, label) => {
    await render([msg(ME, 0, status)]);
    expect(container.querySelector(`.msg-status--${status}`)?.getAttribute("aria-label")).toBe(label);
  });

  it("marks a failed message visibly and for screen readers", async () => {
    await render([msg(ME, 0, "failed")]);
    expect(container.querySelector(".msg--failed")?.textContent).toContain("(not sent)");
    expect(container.querySelector(".msg-status--failed")?.textContent).toBe("Not sent");
  });

  it("keeps message text as plain text", async () => {
    const m = { ...msg(BOB, 0), content: "<b>hi</b>\nthere" };
    await render([m]);
    const bubble = container.querySelector(".msg");
    expect(bubble?.querySelector("b")).toBeNull();
    expect(bubble?.textContent).toBe("<b>hi</b>\nthere");
  });
});
