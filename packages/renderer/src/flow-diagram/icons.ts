import type { FlowIcon } from "./types.ts";

/** Inner markup for a 24x24 viewBox, stroked via the `.icon` CSS class. "ai" renders as a text badge instead — see render.ts. */
export const ICONS: Record<Exclude<FlowIcon, "ai">, string> = {
  ui: '<rect class="icon" x="3" y="4" width="18" height="15" rx="1.5"/><path class="icon" d="M3 8h18"/>',
  api: '<path class="icon" d="M8 6l-5 6 5 6"/><path class="icon" d="M16 6l5 6-5 6"/>',
  handler:
    '<path class="icon" d="M8 4l-4 8 4 8"/><path class="icon" d="M16 4l4 8-4 8"/><path class="icon" d="M11 20l2-16"/>',
  "event-store":
    '<path class="icon" d="M4 6c0-1.5 3.6-2.5 8-2.5S20 4.5 20 6s-3.6 2.5-8 2.5S4 7.5 4 6z"/><path class="icon" d="M4 6v12c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5V6"/><path class="icon" d="M4 12c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5"/>',
  database:
    '<path class="icon" d="M4 6c0-1.5 3.6-2.5 8-2.5S20 4.5 20 6s-3.6 2.5-8 2.5S4 7.5 4 6z"/><path class="icon" d="M4 6v12c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5V6"/>',
  inbox: '<path class="icon" d="M3 6h18v13H3z"/><path class="icon" d="M3 6l9 7 9-7"/>',
  broadcast:
    '<path class="icon" d="M12 20v-1"/><path class="icon" d="M8.5 15.5a5 5 0 017 0"/><path class="icon" d="M5 12a9 9 0 0114 0"/>',
  person:
    '<circle class="icon" cx="12" cy="8" r="3.2"/><path class="icon" d="M5 20c0-4 3-6 7-6s7 2 7 6"/>',
  check: '<path class="icon" d="M5 12l5 5L20 6"/>',
  stop: '<rect class="icon" x="7" y="7" width="10" height="10" rx="1.5"/>',
  box: '<rect class="icon" x="4" y="4" width="16" height="16" rx="2"/>',
};
