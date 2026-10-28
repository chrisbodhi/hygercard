// The overlay in a real layout engine: range rects in the root's coordinates,
// and the endpoint tracker across independently scrolling containers.

import { afterEach, describe, expect, it } from "vitest";
import { elementRect, rangeRects } from "../src/harness/overlay/rangeRects";
import { EndpointTracker, type EndpointSpec } from "../src/harness/overlay/tracker";

const frames = (n = 2) => new Promise<void>((resolve) => { const tick = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => tick(left - 1))); tick(n); });

const mounted: HTMLElement[] = [];
afterEach(() => { for (const el of mounted.splice(0)) el.remove(); });

function mount(html: string, style = ""): HTMLElement {
  const root = document.createElement("div");
  root.style.cssText = `position:relative; margin:23px 0 0 37px; padding:5px; border:3px solid #999; width:420px; height:300px; ${style}`;
  root.innerHTML = html;
  document.body.append(root);
  mounted.push(root);
  return root;
}

describe("rangeRects", () => {
  it("returns boxes in the root's padding-box coordinates, whatever its offset, border and padding", () => {
    const root = mount('<div id="box" style="position:absolute; left:50px; top:60px; width:200px; font:16px/20px monospace">hello world</div>');
    const text = root.querySelector("#box")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const [rect] = rangeRects(range, root);
    // The absolutely positioned child is placed from the padding box, which is where the overlay's origin is.
    expect(rect!.left).toBeCloseTo(50, 0);
    expect(rect!.top).toBeGreaterThanOrEqual(60);
    expect(rect!.top).toBeLessThan(62);
    // Five monospace characters: about 48px, a little more in WebKit.
    expect(rect!.right - rect!.left).toBeGreaterThan(44);
    expect(rect!.right - rect!.left).toBeLessThan(54);
  });

  it("splits a wrapped range into one box per line, and drops empty boxes", () => {
    const root = mount('<p id="p" style="margin:0; width:60px; font:16px/20px monospace">aaaa bbbb cccc</p>');
    const text = root.querySelector("#p")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(root.querySelector("#p")!);
    expect(rangeRects(range, root).length).toBe(3);
    range.setStart(text, 3);
    range.setEnd(text, 3);
    expect(rangeRects(range, root)).toEqual([]);
  });

  it("measures elements in the same coordinates, and says when there is no box", () => {
    const root = mount('<div id="a" style="position:absolute; left:10px; top:20px; width:30px; height:40px"></div><div id="b" style="display:none"></div>');
    expect(elementRect(root.querySelector("#a")!, root)).toEqual({ left: 10, top: 20, right: 40, bottom: 60 });
    expect(elementRect(root.querySelector("#b")!, root)).toBeNull();
  });
});

describe("EndpointTracker", () => {
  // Two columns, each its own scroll container, side by side under one root.
  const columns = () =>
    mount(
      `<div id="left"  style="position:absolute; left:0;   top:0; width:200px; height:100px; overflow:auto"><div style="height:600px; position:relative"><div id="a" style="position:absolute; top:300px; height:40px; width:100%"></div></div></div>
       <div id="right" style="position:absolute; left:220px; top:0; width:200px; height:100px; overflow:auto"><div style="height:600px; position:relative"><div id="b" style="position:absolute; top:20px; height:40px; width:100%"></div></div></div>`,
      "padding:0; border:0; width:430px; height:400px",
    );

  const specs = (root: HTMLElement): EndpointSpec[] => [
    { id: "a", target: () => root.querySelector("#a"), side: "right", scroller: () => root.querySelector("#left") },
    { id: "b", target: () => root.querySelector("#b"), side: "left", scroller: () => root.querySelector("#right") },
  ];

  it("clamps an endpoint scrolled out below, and one scrolled out above, each against its own container", async () => {
    const root = columns();
    const tracker = new EndpointTracker(root);
    tracker.sync(specs(root));
    const left = root.querySelector("#left")!;

    let readings = tracker.measureNow();
    expect(readings.get("a")).toMatchObject({ clamp: "below", x: 200 });
    expect(readings.get("b")).toMatchObject({ clamp: null, x: 220, top: 20, bottom: 60 });

    left.scrollTop = 280; // a is now at 20..60 of the visible window
    await frames();
    readings = tracker.snapshot();
    expect(readings.get("a")).toMatchObject({ clamp: null, top: 20, bottom: 60 });

    left.scrollTop = 500; // a has gone off the top
    await frames();
    expect(tracker.snapshot().get("a")).toMatchObject({ clamp: "above", top: 0 });
    // The other container never moved.
    expect(tracker.snapshot().get("b")).toMatchObject({ clamp: null, top: 20 });
    tracker.destroy();
  });

  it("trims an endpoint that is partly scrolled out, without calling it clamped", async () => {
    const root = columns();
    const tracker = new EndpointTracker(root);
    tracker.sync(specs(root));
    root.querySelector("#left")!.scrollTop = 270; // a spans 30..70 -> wholly visible
    root.querySelector("#left")!.scrollTop = 320; // a spans -20..20 -> trimmed at the top
    await frames();
    expect(tracker.snapshot().get("a")).toMatchObject({ clamp: null, top: 0, bottom: 20 });
    tracker.destroy();
  });

  it("batches: many scrolls in one frame notify once", async () => {
    const root = columns();
    const tracker = new EndpointTracker(root);
    tracker.sync(specs(root));
    await frames();
    let notified = 0;
    tracker.subscribe(() => notified++);
    const left = root.querySelector("#left")!;
    for (let y = 280; y <= 420; y += 10) left.scrollTop = y;
    await frames();
    expect(notified).toBe(1);
    tracker.destroy();
  });

  it("does not notify when nothing an endpoint depends on moved", async () => {
    const root = columns();
    const tracker = new EndpointTracker(root);
    tracker.sync(specs(root));
    await frames();
    let notified = 0;
    tracker.subscribe(() => notified++);
    root.querySelector("#left")!.scrollTop = 0;
    root.dispatchEvent(new Event("scroll"));
    await frames();
    expect(notified).toBe(0);
    tracker.destroy();
  });

  it("follows a resize of a container", async () => {
    const root = columns();
    const tracker = new EndpointTracker(root);
    tracker.sync(specs(root));
    await frames();
    expect(tracker.snapshot().get("a")?.clamp).toBe("below");
    (root.querySelector("#left") as HTMLElement).style.height = "280px"; // a at 300..340 is still below
    await frames();
    expect(tracker.snapshot().get("a")?.clamp).toBe("below");
    (root.querySelector("#left") as HTMLElement).style.height = "300px";
    await frames(3);
    expect(tracker.snapshot().get("a")?.clamp).toBe("below"); // top 300 is exactly the window's bottom edge
    (root.querySelector("#left") as HTMLElement).style.height = "320px";
    await frames(3);
    expect(tracker.snapshot().get("a")).toMatchObject({ clamp: null, top: 300, bottom: 320 });
    tracker.destroy();
  });

  it("follows the DOM changing under it", async () => {
    const root = columns();
    const tracker = new EndpointTracker(root);
    tracker.sync(specs(root));
    root.querySelector("#left")!.scrollTop = 250;
    await frames();
    expect(tracker.snapshot().get("a")?.top).toBe(50);
    (root.querySelector("#a") as HTMLElement).style.top = "280px";
    await frames();
    expect(tracker.snapshot().get("a")?.top).toBe(30);
    tracker.destroy();
  });

  it("reads null for an endpoint whose target has gone", async () => {
    const root = columns();
    const tracker = new EndpointTracker(root);
    tracker.sync(specs(root));
    root.querySelector("#b")!.remove();
    expect(tracker.measureNow().get("b")).toBeNull();
    tracker.destroy();
  });

  it("tracks a text range, such as the passage a partial quote came from", async () => {
    const root = mount('<div id="s" style="position:absolute; left:0; top:0; width:200px; height:60px; overflow:auto"><p id="p" style="margin:0 0 200px; font:16px/20px monospace">alpha beta gamma</p></div>');
    const text = root.querySelector("#p")!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 10);
    const tracker = new EndpointTracker(root);
    tracker.sync([{ id: "r", target: () => range, side: "right", scroller: () => root.querySelector("#s") }]);
    const reading = tracker.measureNow().get("r")!;
    expect(reading.x).toBeGreaterThan(90); // ten monospace characters in, about 96px
    expect(reading.x).toBeLessThan(104);
    expect(reading.clamp).toBeNull();
    expect(reading.bottom - reading.top).toBeLessThanOrEqual(22);
    tracker.destroy();
  });

  it("measures every frame during a pulse, for movement no event announces", async () => {
    const root = columns();
    const tracker = new EndpointTracker(root);
    tracker.sync(specs(root));
    root.querySelector("#left")!.scrollTop = 250;
    await frames();
    let notified = 0;
    tracker.subscribe(() => notified++);
    tracker.pulse(200);
    const a = root.querySelector("#a") as HTMLElement;
    const started = performance.now();
    while (performance.now() - started < 150) {
      // Move it without any DOM event the tracker listens for: a transform is not a layout change, but getBoundingClientRect sees it.
      a.style.transform = `translateY(${Math.floor(performance.now() - started) % 7}px)`;
      await frames(1);
    }
    expect(notified).toBeGreaterThan(1);
    tracker.destroy();
  });
});
