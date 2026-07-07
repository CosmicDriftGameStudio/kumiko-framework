// Helpdesk-Feature — Server-Side. Zweite Demo-App neben Assets,
// gleiches Framework-Pattern, andere Domain.

import { defineFeature, registerEntityCrud } from "@cosmicdrift/kumiko-framework/engine";
import { ticketEditScreen, ticketEntity, ticketListScreen } from "./schema";

const open = { access: { openToAll: true } } as const;

export const helpdeskFeature = defineFeature("helpdesk", (r) => {
  registerEntityCrud(r, "ticket", ticketEntity, { write: open, read: open });

  r.screen(ticketEditScreen);
  r.screen(ticketListScreen);

  r.nav({
    id: "helpdesk",
    label: "helpdesk:nav.list",
    order: 20,
    screen: "helpdesk:screen:ticket-list",
  });
  r.nav({
    id: "ticket-new",
    label: "helpdesk:nav.new",
    parent: "helpdesk:nav:helpdesk",
    screen: "helpdesk:screen:ticket-edit",
    order: 10,
  });
});
