// Colours for the dashboard charts.
//
// A BCT keeps the same hue everywhere, keyed by its BCIO URI, so filtering the
// view never repaints the series that remain. Slot order was picked for
// colour-vision separation; changing it needs re-checking, not just a swap.

const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300"];

// Single hue, light to dark, for heatmap magnitude.
const SEQUENTIAL = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec",
  "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab",
];

const EMPTY_CELL = "#f2f1ee";
const OTHER_BCT = "#898781";

// Reserved for pass/fail state. Never used for a series.
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
};

export const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
};

// The six BCTs the study targets, in slot order.
const BCT_SLOTS = {
  BCIO_007002: 0, // goal setting
  BCIO_007010: 1, // action planning
  BCIO_007024: 2, // self-monitor behaviour
  BCIO_007022: 3, // provide feedback
  BCIO_007043: 4, // deliver appraisal support
  BCIO_007041: 5, // deliver emotional support
};

// The agentic runs tag messages by snake_case name rather than URI.
export const BCT_KEY_TO_URI = {
  goal_setting: "BCIO_007002",
  action_planning: "BCIO_007010",
  self_monitoring: "BCIO_007024",
  provide_feedback: "BCIO_007022",
  appraisal_support: "BCIO_007043",
  emotional_support: "BCIO_007041",
};

// Anything outside the targeted six is grey.
export function bctColor(uri) {
  const slot = BCT_SLOTS[uri];
  return slot === undefined ? OTHER_BCT : SERIES[slot];
}

// Step on the sequential ramp for a magnitude in 0..1.
export function rampColor(t) {
  if (!Number.isFinite(t) || t <= 0) return EMPTY_CELL;
  const last = SEQUENTIAL.length - 1;
  return SEQUENTIAL[Math.min(last, Math.round(t * last))];
}
