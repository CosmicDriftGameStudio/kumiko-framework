import { createEntity, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { IMPORTED_NAME } from "./names";

const RELEASE = "release";
const SUBJECT_TYPE = "lease";
const widened: string = "other";

const releaseEntity = createEntity({ fields: {} });
const leaseEntity = createEntity({ fields: {} });
const opaqueEntity = createEntity({ fields: {} });

export const feature = defineFeature("releases", (r) => {
  r.entity({ name: RELEASE, ...releaseEntity });
  r.entity({ name: widened, ...opaqueEntity });
});

const leaseTable = buildEntityTable(SUBJECT_TYPE, leaseEntity);
const importedTable = buildEntityTable(IMPORTED_NAME, createEntity({ fields: {} }));
