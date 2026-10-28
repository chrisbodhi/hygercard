import { defineVariant } from "../../harness/variant";
import { ColumnsBaseline } from "./ColumnsBaseline";

export const schema = {
  leftWidth: { value: 28, min: 15, max: 50, step: 1, label: "left column (weight)" },
  centerWidth: { value: 44, min: 20, max: 70, step: 1, label: "center column (weight)" },
  rightWidth: { value: 28, min: 15, max: 50, step: 1, label: "right column (weight)" },
  bandCurvature: { value: 0.55, min: 0, max: 1, step: 0.01, label: "band curvature" },
  bandOpacity: { value: 0.25, min: 0.05, max: 1, step: 0.01, label: "band opacity" },
  dragThreshold: { value: 6, min: 0, max: 40, step: 1, label: "drag threshold (px)" },
  bandVisibility: { value: "always", options: ["always", "on hover", "by state"] as const, label: "band visibility" },
};

export default defineVariant({
  id: "columns-baseline",
  name: "columns-baseline",
  description: "Two imported blygs either side of a thread draft. Drag a card, or a selection, into the draft.",
  knobs: schema,
  Component: ColumnsBaseline,
});
