import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const backingTable = "read_notes";
const NOTE = "note";

export const feature = defineFeature("notes", (r) => {
  r.entity({ name: "task", ...createEntity({ fields: {} }) });
  r.entity({ name: NOTE, ...createEntity({ fields: {} }), backingTable });
  r.entity({ name: "plain", ...{ fields: {} } });
  r.crud("project", createEntity({ fields: {} }), { write: { access } });
});

const table = buildEntityTable("memo", createEntity({ fields: {} }), { schema });
const literalTable = buildEntityTable("scratch", { fields: {} });
const { executor } = createEntityExecutor("audit", createEntity({ fields: {} }));
const meta = deriveEntityTableMeta("log", createEntity({ fields: {} }), options);
