// Tracks band endpoints across independently scrolling containers.
//
// An endpoint is an element or a text range somewhere under the overlay root.
// Anything that can move it (a scroll in any container under the root, a resize,
// a change to the DOM, an animation) schedules one measure on the next animation
// frame, however many things fired. Each endpoint is clamped to the visible
// window of its own scroll container and says whether it was scrolled out above
// or below it.

import { boundsOf, endpointOf, intersect, sameEndpoint, type Endpoint, type Rect } from "./geometry";
import { elementRect, rangeRects } from "./rangeRects";

export interface EndpointSpec {
  id: string;
  /** What the endpoint is, looked up at every measure; null when it is gone. */
  target: () => Element | Range | null;
  /** Which edge of the target a band attaches to. */
  side: "left" | "right";
  /** The scroll container whose visible window clamps the endpoint. Null: the overlay root's. */
  scroller: () => Element | null;
}

export type Readings = ReadonlyMap<string, Endpoint | null>;

export class EndpointTracker {
  private specs = new Map<string, EndpointSpec>();
  private current: Readings = new Map();
  private listeners = new Set<() => void>();
  private frame = 0;
  private pulseUntil = 0;
  private resize: ResizeObserver;
  private mutations: MutationObserver;
  private watched = new Set<Element>();

  constructor(private readonly root: HTMLElement) {
    // `scroll` does not bubble, but it can be captured: one listener hears every container under the root.
    root.addEventListener("scroll", this.schedule, { capture: true, passive: true });
    window.addEventListener("resize", this.schedule);
    this.resize = new ResizeObserver(this.schedule);
    this.resize.observe(root);
    this.mutations = new MutationObserver(this.schedule);
    this.mutations.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
  }

  /** Replace the set of endpoints being tracked. Cheap to call on every render. */
  sync(specs: readonly EndpointSpec[]): void {
    this.specs = new Map(specs.map((spec) => [spec.id, spec]));
    const wanted = new Set<Element>();
    for (const spec of specs) {
      const target = spec.target();
      if (target instanceof Element) wanted.add(target);
      const scroller = spec.scroller();
      if (scroller) wanted.add(scroller);
    }
    for (const element of this.watched) if (!wanted.has(element)) this.resize.unobserve(element);
    for (const element of wanted) if (!this.watched.has(element)) this.resize.observe(element);
    this.watched = wanted;
    this.schedule();
  }

  /** Measure every frame for a while: for movement no event announces, such as an animation. */
  pulse(milliseconds = 500): void {
    this.pulseUntil = performance.now() + milliseconds;
    this.schedule();
  }

  readonly schedule = (): void => {
    if (this.frame === 0) this.frame = requestAnimationFrame(this.measure);
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): Readings => this.current;

  /** Measure now, outside the frame loop. Tests and callers that need a reading this instant use it. */
  measureNow(): Readings {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.measure();
    return this.current;
  }

  private measure = (): void => {
    this.frame = 0;
    const whole: Rect = { left: 0, top: 0, right: this.root.clientWidth, bottom: this.root.clientHeight };
    const next = new Map<string, Endpoint | null>();
    let changed = this.specs.size !== this.current.size;

    for (const spec of this.specs.values()) {
      const reading = this.read(spec, whole);
      next.set(spec.id, reading);
      if (!sameEndpoint(reading, this.current.get(spec.id) ?? null)) changed = true;
    }
    if (changed) {
      this.current = next;
      for (const listener of this.listeners) listener();
    }
    if (performance.now() < this.pulseUntil) this.schedule();
  };

  private read(spec: EndpointSpec, whole: Rect): Endpoint | null {
    const target = spec.target();
    if (!target) return null;
    const rect = target instanceof Range ? boundsOf(rangeRects(target, this.root)) : elementRect(target, this.root);
    if (!rect) return null;
    const scroller = spec.scroller();
    const window = scroller ? (() => { const r = elementRect(scroller, this.root); return r && intersect(r, whole); })() : whole;
    return window ? endpointOf(rect, spec.side, window) : null;
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.root.removeEventListener("scroll", this.schedule, { capture: true });
    window.removeEventListener("resize", this.schedule);
    this.resize.disconnect();
    this.mutations.disconnect();
    this.listeners.clear();
  }
}
