// Icons drawn to match the KI-first boards; lucide's stock glyphs differ in stroke detail.
import { createLucideIcon } from "lucide-react";

export const DrawnSearch = createLucideIcon("drawn-search", [
  ["circle", { cx: "11", cy: "11", r: "7", key: "drawn-search-lens" }],
  ["path", { d: "m20 20-3.5-3.5", key: "drawn-search-handle" }],
]);

export const DrawnSparkles = createLucideIcon("drawn-sparkles", [
  ["path", { d: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z", key: "large" }],
  ["path", { d: "M19 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9z", key: "small" }],
]);

export const DrawnPencil = createLucideIcon("drawn-pencil", [
  ["path", { d: "M4 20h4L19 9l-4-4L4 16z", key: "body" }],
  ["path", { d: "m13 7 4 4", key: "tip" }],
]);

export const DrawnFilter = createLucideIcon("drawn-filter", [
  ["path", { d: "M4 6h16l-6 7v5l-4 2v-7z", key: "funnel" }],
]);

export const DrawnWand = createLucideIcon("drawn-wand", [
  [
    "path",
    {
      d: "m4 20 10-10M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.7 1.3 1.3.7-1.3.7-.7 1.3-.7-1.3-1.3-.7 1.3-.7z",
      key: "wand",
    },
  ],
]);

export const DrawnPanel = createLucideIcon("drawn-panel", [
  ["rect", { x: "3", y: "4", width: "18", height: "16", rx: "2", key: "frame" }],
  ["path", { d: "M9 4v16", key: "divider" }],
]);
