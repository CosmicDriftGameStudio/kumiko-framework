import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readerRoles } from "../access";

const DAY_MS = 86_400_000;
const WINDOW_END_MS = Date.UTC(2026, 10, 30);
const OPENED_PER_DAY = [4, 7, 3, 9, 6, 5, 8];

// Fixed sample figures: the screen is about how a dashboard is drawn, not about counting.
// Each panel reads its part through `resultField`.
export const ticketDesignQuery = defineQueryHandler({
  name: "ticket:design",
  schema: z.object({}),
  handler: async () => ({
    subtitle: "Support desk, November 2026",
    kpis: {
      opened: 42,
      openedSub: "+6 vs. last week",
      openedSubTone: "positive",
      escalated: 3,
      escalatedSub: "1 overdue",
      escalatedSubTone: "negative",
    },
    weekly: {
      windowStartMs: WINDOW_END_MS - 6 * DAY_MS,
      windowEndMs: WINDOW_END_MS,
      series: [
        {
          key: "opened",
          label: "Opened",
          points: OPENED_PER_DAY.map((value, index) => ({
            atMs: WINDOW_END_MS - (6 - index) * DAY_MS,
            value,
          })),
        },
      ],
    },
    byTeam: {
      rows: [
        {
          key: "billing",
          label: "Billing",
          value: 14,
          segments: [
            { key: "open", label: "Open", value: 9 },
            { key: "closed", label: "Closed", value: 5 },
          ],
        },
        {
          key: "tech",
          label: "Technical",
          value: 20,
          segments: [
            { key: "open", label: "Open", value: 6 },
            { key: "closed", label: "Closed", value: 14 },
          ],
        },
      ],
    },
  }),
  access: readerRoles,
});
