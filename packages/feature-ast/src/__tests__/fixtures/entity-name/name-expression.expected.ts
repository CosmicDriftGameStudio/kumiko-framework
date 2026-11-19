import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { IMPORTED_NAME } from "./names";

const RELEASE = "release";
const SUBJECT_TYPE = "lease";
const widened: string = "other";

const releaseEntity = createEntity({ name: RELEASE, fields: {} });
const leaseEntity = createEntity({ name: SUBJECT_TYPE, fields: {} });
const opaqueEntity = createEntity({ fields: {} });

export const feature = defineFeature("releases", (r) => {
  r.entity(releaseEntity);
  r.entity({ name: widened, ...opaqueEntity });
});

const leaseTable = buildEntityTable(leaseEntity);
const importedTable = buildEntityTable(IMPORTED_NAME, createEntity({ fields: {} }));
