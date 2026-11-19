import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { externalEntity } from "some-package";

const ownEntity = createEntity({ fields: {} });

export const feature = defineFeature("external", (r) => {
  r.entity({ name: dynamicName, ...ownEntity });
  r.crud(dynamicName, ownEntity);
  r.crud("external", externalEntity);
});
