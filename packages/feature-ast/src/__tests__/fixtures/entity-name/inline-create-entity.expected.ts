import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const backingTable = "read_notes";
const NOTE = "note";

export const feature = defineFeature("notes", (r) => {
  r.entity(createEntity({ name: "task", fields: {} }));
  r.entity({ ...createEntity({ name: NOTE, fields: {} }), backingTable });
  r.entity({ name: "plain", fields: {} });
  r.crud(createEntity({ name: "project", fields: {} }), { write: { access } });
});

const table = buildEntityTable(createEntity({ name: "memo", fields: {} }), { schema });
const literalTable = buildEntityTable({ name: "scratch", fields: {} });
const { executor } = createEntityExecutor(createEntity({ name: "audit", fields: {} }));
const meta = deriveEntityTableMeta(createEntity({ name: "log", fields: {} }), options);
