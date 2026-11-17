import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { externalEntity } from "some-package";

export const feature = defineFeature("external", (r) => {
  r.entity({ name: "external", ...externalEntity });
  r.crud("external", externalEntity);
  r.entity({ name: dynamicName, ...externalEntity });
});
