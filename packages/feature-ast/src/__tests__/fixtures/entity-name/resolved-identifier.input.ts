import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const baseEntity = createEntity({ name: "person", fields: {} });
const backing = { ...baseEntity, table: "people_backing" };
const plainLiteral = { fields: {} } as unknown as EntityDefinition;
const wrapped = createEntity({ fields: {} }) as EntityDefinition;
const aliased = wrapped;

function createHelpdeskEntity() {
  return createEntity({ fields: {} });
}
const helpdeskEntity = createHelpdeskEntity();

export const feature = defineFeature("people", (r) => {
  r.entity({ name: "person", ...backing });
  r.entity({ name: "thing", ...plainLiteral });
  r.entity({ name: "wrapped", ...wrapped });
  r.entity({ name: "aliased", ...aliased });
  r.entity({ name: "helpdesk", ...helpdeskEntity });
});

const table = buildEntityTable("person", backing);
