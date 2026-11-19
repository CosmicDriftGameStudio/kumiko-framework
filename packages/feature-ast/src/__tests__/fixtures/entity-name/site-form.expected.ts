import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

function buildFeature(entity: EntityDefinition, dynamicName: string) {
  return defineFeature("crm", (r) => {
    r.entity({ ...entity, name: "contact" });
    r.entity({ ...entity, name: dynamicName, table: "read_x" });
    r.crud({ ...entity, name: "contact" }, { write: { access } });
  });
}

const table = buildEntityTable({ ...makeEntity(), name: "contact" });
