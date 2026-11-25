import { describe, expect, it } from "vitest";

import type { UiMessage } from "./state";
import { buildThread } from "./thread";

const ME = "me";
const BOB = "bob";
const now = new Date(2026, 10, 25, 15, 0);

let n = 0;
function msg(senderId: string, local: [number, number, number, number, number]): UiMessage {
  n += 1;
  return {
    id: `m${n}`,
    conversationId: "c",
    senderId,
    clientMessageId: `c${n}`,
    content: `message ${n}`,
    sequenceNum: n,
    createdAt: new Date(...local).toISOString(),
    deliveryStatus: "sent",
  };
}

const shape = (items: ReturnType<typeof buildThread>) =>
  items.map((i) => (i.kind === "day" ? `day:${i.label}` : `${i.mine ? "me" : "them"}:${i.messages.length}`));

describe("buildThread", () => {
  it("returns nothing for an empty conversation", () => {
    expect(buildThread([], ME, now)).toEqual([]);
  });

  it("groups consecutive messages from the same sender", () => {
    const items = buildThread(
      [
        msg(BOB, [2026, 10, 25, 9, 0]),
        msg(BOB, [2026, 10, 25, 9, 1]),
        msg(ME, [2026, 10, 25, 9, 2]),
        msg(ME, [2026, 10, 25, 9, 3]),
        msg(BOB, [2026, 10, 25, 9, 4]),
      ],
      ME,
      now,
      "en-GB",
    );
    expect(shape(items)).toEqual(["day:Today", "them:2", "me:2", "them:1"]);
  });

  it("starts a new group after a long gap", () => {
    const items = buildThread(
      [msg(ME, [2026, 10, 25, 9, 0]), msg(ME, [2026, 10, 25, 9, 5]), msg(ME, [2026, 10, 25, 9, 11])],
      ME,
      now,
      "en-GB",
    );
    expect(shape(items)).toEqual(["day:Today", "me:2", "me:1"]);
  });

  it("adds a separator and breaks the group when the day changes", () => {
    const items = buildThread(
      [msg(BOB, [2026, 10, 24, 23, 58]), msg(BOB, [2026, 10, 25, 0, 1])],
      ME,
      now,
      "en-GB",
    );
    expect(shape(items)).toEqual(["day:Yesterday", "them:1", "day:Today", "them:1"]);
  });

  it("keeps group keys stable when an optimistic message is confirmed", () => {
    const optimistic = { ...msg(ME, [2026, 10, 25, 9, 0]), id: "opt-x", sequenceNum: 0 };
    const confirmed = { ...optimistic, id: "real", sequenceNum: 7 };
    const before = buildThread([optimistic], ME, now)[1];
    const after = buildThread([confirmed], ME, now)[1];
    expect(before?.key).toBe(after?.key);
  });
});
