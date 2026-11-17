import {
  createEntity,
  createEntityExecutor,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

export const TICKET_STATUSES = ["open", "closed"] as const;

export const ticketEntity = createEntity({
  table: "read_sample_tickets",
  fields: {
    title: createTextField({ personal: false, reason: "is_business_data", required: true }),
    status: createSelectField({ options: TICKET_STATUSES, default: "open", required: true }),
  },
  // Defined once: the queue list and the dashboard tile both read it.
  namedFilters: {
    "open-work": { filters: () => [{ field: "status", op: "eq", value: "open" }] },
  },
});

export const { executor: ticketExecutor } = createEntityExecutor("ticket", ticketEntity);
