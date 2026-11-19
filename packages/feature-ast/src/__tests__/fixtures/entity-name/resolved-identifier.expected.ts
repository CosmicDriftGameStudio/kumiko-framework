import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const baseEntity = createEntity({ name: "person", fields: {} });
const backing = { ...baseEntity, table: "people_backing", name: "person" };
const plainLiteral = { name: "thing", fields: {} } as unknown as EntityDefinition;
const wrapped = createEntity({ name: "wrapped", fields: {} }) as EntityDefinition;
const aliased = wrapped;

function createHelpdeskEntity() {
  return createEntity({ name: "helpdesk", fields: {} });
}
const helpdeskEntity = createHelpdeskEntity();

export const feature = defineFeature("people", (r) => {
  r.entity(backing);
  r.entity(plainLiteral);
  r.entity(wrapped);
  r.entity({ ...aliased, name: "aliased" });
  r.entity(helpdeskEntity);
});

const table = buildEntityTable(backing);
