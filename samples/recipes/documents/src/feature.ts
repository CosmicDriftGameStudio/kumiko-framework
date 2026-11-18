// kumiko-feature-version: 1
// Documents Sample
//
// A `contract` entity with a file field becomes a document source without knowing about the
// documents feature: the capture rule below files every saved contract file as a document of
// category "contract" and links it to the contract and to its property. Who sees the document
// follows from who may read the linked records and the contract that owns the file.
//
// An `offer` references a filed document. The list cell of that reference links the document's
// file under the document title, because filed-document has exactly one file field; a user who
// may not read the document sees neither the title nor the file.

import { createDocumentsFeature } from "@cosmicdrift/kumiko-bundled-features/documents";
import {
  createEntity,
  createFileField,
  createReferenceField,
  createTextField,
  defineEntityCreateHandler,
  defineEntityDetailHandler,
  defineEntityListHandler,
  defineEntityUpdateHandler,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

const text = () =>
  createTextField({ personal: false, reason: "is_business_data", required: true, maxLength: 120 });

export const propertyEntity = createEntity({
  name: "property",
  table: "read_sample_documents_properties",
  fields: { name: text() },
  access: { read: { PropertyReader: "all", TenantAdmin: "all" } },
});

export const contractEntity = createEntity({
  name: "contract",
  table: "read_sample_documents_contracts",
  fields: { name: text(), propertyId: text(), file: createFileField() },
  access: { read: { ContractReader: "all", TenantAdmin: "all" } },
});

export const offerEntity = createEntity({
  name: "offer",
  table: "read_sample_documents_offers",
  fields: {
    name: text(),
    receipt: createReferenceField({
      entity: "documents:filed-document",
      labelField: "title",
      personal: false,
      reason: "is_system_identifier",
    }),
  },
  access: { read: { PropertyReader: "all", ContractReader: "all", TenantAdmin: "all" } },
});

const access = { roles: ["PropertyReader", "ContractReader", "TenantAdmin"] };

export const propertyManagement = defineFeature("property-management", (r) => {
  r.requires({ features: ["files", "documents"] });
  r.entity(propertyEntity);
  r.entity(contractEntity);
  r.entity(offerEntity);
  for (const [name, entity] of [
    ["property", propertyEntity],
    ["contract", contractEntity],
    ["offer", offerEntity],
  ] as const) {
    r.writeHandler(defineEntityCreateHandler(name, entity, { access }));
    r.writeHandler(defineEntityUpdateHandler(name, entity, { access: { roles: ["TenantAdmin"] } }));
    r.queryHandler(defineEntityListHandler(name, entity, { access }));
    r.queryHandler(defineEntityDetailHandler(name, entity, { access }));
  }
  r.screen({ id: "offer-list", type: "entityList", entity: "offer", columns: ["name", "receipt"] });
});

export const documents = createDocumentsFeature({
  categories: ["contract", "insurance"],
  linkTargets: ["property", "contract"],
  access,
  capture: [
    {
      entity: "contract",
      field: "file",
      category: "contract",
      title: (row) => `Contract ${String(row["name"])}`,
      links: (row) => [{ entityType: "property", entityId: String(row["propertyId"]) }],
    },
  ],
});
