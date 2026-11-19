import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const feature = defineFeature("reports", (r) => {
  r.writeHandler({
    name: "reports:write:list-all",
    schema,
    access,
    escapeHatch: { reason: "lists every tenant", grants: ["unsafeRaw"] },
    perform: stepsPipeline(({ r: step }) => [
      step.step.read.findMany("items", {
        table: itemsTable,
        unsafeAllTenants: { reason: "lists every tenant" },
      }),
    ]),
  });
});
