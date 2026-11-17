import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

function buildFeature(entity: EntityDefinition, dynamicName: string) {
  return defineFeature("crm", (r) => {
    r.entity({ name: "contact", ...entity });
    r.entity({ name: dynamicName, ...entity, table: "read_x" });
    r.crud("contact", entity, { write: { access } });
  });
}

const table = buildEntityTable("contact", makeEntity());
