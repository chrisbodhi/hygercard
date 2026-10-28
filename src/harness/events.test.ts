import { afterEach, describe, expect, it } from "vitest";
import { eventLog } from "./events";

afterEach(() => eventLog.clear());

describe("event log", () => {
  it("records events in order with a sequence number and a timestamp", () => {
    eventLog.emit({ type: "drag.start", kind: "whole", item: { origin: "o", id: "i" } });
    eventLog.emit({ type: "drag.cancel", kind: "whole", reason: "released outside the draft" });
    const [first, second] = eventLog.snapshot();
    expect(first!.seq).toBeLessThan(second!.seq);
    expect(first!.event.type).toBe("drag.start");
    expect(first!.at).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  });

  it("hands React a new snapshot only when something changed", () => {
    const before = eventLog.snapshot();
    expect(eventLog.snapshot()).toBe(before);
    eventLog.emit({ type: "drag.cancel", kind: "partial", reason: "x" });
    expect(eventLog.snapshot()).not.toBe(before);
  });

  it("notifies subscribers, and stops when they unsubscribe", () => {
    let calls = 0;
    const stop = eventLog.subscribe(() => calls++);
    eventLog.emit({ type: "drag.cancel", kind: "whole", reason: "x" });
    stop();
    eventLog.emit({ type: "drag.cancel", kind: "whole", reason: "y" });
    expect(calls).toBe(1);
  });

  it("keeps the last thousand", () => {
    for (let i = 0; i < 1100; i++) eventLog.emit({ type: "drag.cancel", kind: "whole", reason: String(i) });
    const all = eventLog.snapshot();
    expect(all).toHaveLength(1000);
    expect((all[0]!.event as { reason: string }).reason).toBe("100");
  });
});
