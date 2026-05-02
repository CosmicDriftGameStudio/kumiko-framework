// Asset-Tracker Schema — Marketing-Demo. Nutzt die saubere Factory-API
// (createEntity + createXField), wie publicstatus auch. Vermeidet das
// Inline-Object-Cast-Pattern, das in showcase/ui-walkthrough als reine
// UI-Demo OK ist, in einem server-seitigen Sample mit echten Writes
// aber Type-Safety verschenkt.

import {
  createDateField,
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
} from "@kumiko/framework/engine";
import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@kumiko/framework/ui-types";

export const ASSET_TYPES = ["laptop", "monitor", "phone", "tool", "license", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_STATUSES = ["available", "lent", "maintenance", "broken"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_DEPARTMENTS = [
  "it",
  "marketing",
  "sales",
  "engineering",
  "finance",
  "hr",
  "shared",
] as const;
export type AssetDepartment = (typeof ASSET_DEPARTMENTS)[number];

export const assetEntity = createEntity({
  fields: {
    name: createTextField({ required: true, sortable: true, searchable: true }),
    type: createSelectField({
      options: ASSET_TYPES,
      default: "laptop",
      sortable: true,
      filterable: true,
    }),
    status: createSelectField({
      options: ASSET_STATUSES,
      default: "available",
      sortable: true,
      filterable: true,
    }),
    department: createSelectField({
      options: ASSET_DEPARTMENTS,
      default: "shared",
      sortable: true,
      filterable: true,
    }),
    owner: createTextField({ searchable: true, sortable: true }),
    location: createTextField({ searchable: true, sortable: true, filterable: true }),
    serialNumber: createTextField({ searchable: true }),
    vendor: createTextField({ searchable: true }),
    price: createNumberField({ sortable: true }),
    purchaseDate: createDateField({ sortable: true }),
    warrantyUntil: createDateField({ sortable: true }),
    notes: createTextField({ multiline: { rows: 3 } }),
  },
});

export const assetEditScreen: EntityEditScreenDefinition = {
  id: "asset-edit",
  type: "entityEdit",
  entity: "asset",
  layout: {
    sections: [
      {
        title: "assets:section.basics",
        columns: 2,
        fields: [{ field: "name", span: 2 }, "type", "status", "department", "serialNumber"],
      },
      {
        title: "assets:section.assignment",
        columns: 2,
        fields: ["owner", "location", "notes"],
      },
      {
        title: "assets:section.purchase",
        columns: 2,
        fields: ["vendor", "price", "purchaseDate", "warrantyUntil"],
      },
    ],
  },
};

export const assetListScreen: EntityListScreenDefinition = {
  id: "asset-list",
  type: "entityList",
  entity: "asset",
  columns: [
    "name",
    "type",
    "status",
    "department",
    "owner",
    "location",
    "vendor",
    "purchaseDate",
    "warrantyUntil",
  ],
  pageSize: 25,
  defaultSort: { field: "name", dir: "asc" },
};
