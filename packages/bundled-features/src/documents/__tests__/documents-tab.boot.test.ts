import { describe, expect, test } from "bun:test";
import {
  createEntity,
  createTextField,
  defineEntityDetailHandler,
  defineFeature,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { createFilesFeature } from "@cosmicdrift/kumiko-framework/files";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import { createDocumentsFeature } from "../feature.ts";
import { documentsTab } from "../tab.ts";

const propertyEntity = createEntity({
  table: "doc_tab_properties",
  fields: {
    name: createTextField({ required: true, maxLength: 64, personal: false, reason: "test" }),
  },
});

const hostFeature = defineFeature("tab-host", (r) => {
  r.entity({ name: "property", ...propertyEntity });
  r.queryHandler(
    defineEntityDetailHandler("property", propertyEntity, { access: { roles: ["TenantAdmin"] } }),
  );
  r.screen({
    id: "property-detail",
    type: "projectionDetail",
    query: "tab-host:query:property:detail",
    layout: {
      mode: "tabs",
      sections: [
        { id: "main", title: "tab-host.tab.main", fields: ["name"] },
        documentsTab("property"),
      ],
    },
  });
});

describe("documentsTab", () => {
  test("a record screen with the documents tab boots", () => {
    const documents = createDocumentsFeature({
      categories: ["contract"],
      linkTargets: ["property"],
    });
    const features = withBootValidatorFixture([createFilesFeature(), hostFeature, documents]);
    expect(() =>
      validateBoot(features, { env: { FILE_STORAGE_PROVIDER: "memory" } }),
    ).not.toThrow();
  });
});
