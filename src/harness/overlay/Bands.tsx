// The connector bands: a ribbon from where a quote came from to where it landed
// in the draft, coloured by the state of the quote. Drawn in one SVG laid over
// the overlay root, which never intercepts the pointer.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { BandState } from "../../core/anchors";
import { bandPath, type Endpoint } from "./geometry";
import { EndpointTracker, type EndpointSpec } from "./tracker";

export interface BandSpec {
  id: string;
  state: BandState;
  /** The source end: the located passage of a partial quote, or the whole item card. */
  source: EndpointSpec;
  /** The center end: the rendered transclusion block in the draft preview. */
  center: EndpointSpec;
}

export type Visibility = "always" | "on hover" | "by state";

const COLORS: Record<BandState, string> = {
  current: "#4a7fb5",
  stale: "#d98c1f",
  withdrawn: "#7a7a7a",
  drifted: "#c0392b",
  missing: "#b03a8c",
};

export interface BandsProps {
  tracker: EndpointTracker | null;
  bands: readonly BandSpec[];
  curvature: number;
  opacity: number;
  visibility: Visibility;
  /** Ids of the bands whose quote is under the pointer. */
  hovered?: ReadonlySet<string>;
  /** Other endpoints for the same tracker to follow, such as a selection handle. */
  extra?: readonly EndpointSpec[];
}

/** Whether a band is drawn at all, under a visibility setting. */
export function isShown(visibility: Visibility, state: BandState, hovered: boolean): boolean {
  if (visibility === "always") return true;
  if (visibility === "on hover") return hovered;
  return state !== "current"; // by state: only the ones that need a look
}

const Chevron = ({ at }: { at: Endpoint }) => {
  const y = at.clamp === "above" ? at.top : at.bottom;
  const tip = at.clamp === "above" ? -6 : 6;
  return <path d={`M ${at.x - 5} ${y + tip * -0.2} L ${at.x} ${y + tip} L ${at.x + 5} ${y + tip * -0.2}`} fill="none" stroke="currentColor" strokeWidth={1.5} />;
};

export function Bands({ tracker, bands, curvature, opacity, visibility, hovered, extra = [] }: BandsProps) {
  // Let the tracker know what to follow, after every render: the targets are looked up lazily, so a stale spec is harmless.
  useEffect(() => tracker?.sync([...bands.flatMap((band) => [band.source, band.center]), ...extra]));
  const [empty] = useState(() => new Map<string, Endpoint | null>());
  const readings = useSyncExternalStore(
    tracker?.subscribe ?? (() => () => {}),
    () => tracker?.snapshot() ?? empty,
  );

  return (
    <svg className="bands" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "hidden" }}>
      {bands.map((band) => {
        const from = readings.get(band.source.id);
        const to = readings.get(band.center.id);
        if (!from || !to || !isShown(visibility, band.state, hovered?.has(band.id) ?? false)) return null;
        // Both ends scrolled out the same way: nothing to connect.
        if (from.clamp !== null && from.clamp === to.clamp) return null;
        const color = COLORS[band.state];
        const dashed = band.state === "withdrawn" || band.state === "missing";
        return (
          <g key={band.id} color={color} data-band={band.id} data-state={band.state}>
            <path d={bandPath(from, to, curvature)} fill={color} fillOpacity={opacity} stroke={color} strokeOpacity={Math.min(1, opacity + 0.3)} strokeDasharray={dashed ? "4 3" : undefined} />
            {from.clamp && <Chevron at={from} />}
            {to.clamp && <Chevron at={to} />}
          </g>
        );
      })}
    </svg>
  );
}

/** A tracker for the overlay root, made once the root exists and destroyed with it. */
export function useTracker(root: HTMLElement | null): EndpointTracker | null {
  const [tracker, setTracker] = useState<EndpointTracker | null>(null);
  useEffect(() => {
    if (!root) return;
    const made = new EndpointTracker(root);
    setTracker(made);
    return () => {
      made.destroy();
      setTracker(null);
    };
  }, [root]);
  return tracker;
}
