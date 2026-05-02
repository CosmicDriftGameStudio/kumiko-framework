// Helpdesk-Feature — Server-Side. Zweite Demo-App neben Assets,
// gleiches Framework-Pattern, andere Domain.

import {
  defineEntityCreateHandler,
  defineEntityDeleteHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@kumiko/framework/engine";
import { ticketEditScreen, ticketEntity, ticketListScreen } from "./schema";

const open = { access: { openToAll: true } } as const;

export const helpdeskFeature = defineFeature("helpdesk", (r) => {
  r.entity("ticket", ticketEntity);

  r.writeHandler(defineEntityCreateHandler("ticket", ticketEntity, open));
  r.writeHandler(defineEntityUpdateHandler("ticket", ticketEntity, open));
  r.writeHandler(defineEntityDeleteHandler("ticket", ticketEntity, open));
  r.queryHandler(defineEntityListHandler("ticket", ticketEntity, open));
  r.queryHandler(defineEntityDetailHandler("ticket", ticketEntity, open));

  r.screen(ticketEditScreen);
  r.screen(ticketListScreen);

  r.nav({ id: "helpdesk", label: "helpdesk:nav.list", order: 20, screen: "ticket-list" });
  r.nav({
    id: "ticket-new",
    label: "helpdesk:nav.new",
    parent: "helpdesk",
    screen: "ticket-edit",
    order: 10,
  });
});
