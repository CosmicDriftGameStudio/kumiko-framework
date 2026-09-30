import type {
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";

const OPEN_ACCESS = {
  openToAll: {
    reason: "demo app: any signed-in user manages every vehicle; there is no per-user ownership",
  },
} as const;

const DETAIL_FIELDS = [
  "kraftstoffart",
  "getriebe",
  "leistungKw",
  "karosserieform",
  "ausstattungslinie",
  "zustand",
  "vorbesitzer",
  "garantieMonate",
  "scheckheft",
  "beschreibung",
] as const;

export const vehicleListScreen: EntityListScreenDefinition = {
  id: "vehicle-list",
  type: "entityList",
  entity: "vehicle",
  columns: ["marke", "modell", "baujahr", "preis", "zustand"],
  searchPlaceholder: "vehicles.search.placeholder",
  defaultSort: { field: "marke", dir: "asc" },
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "vehicles.action.edit",
      screen: "vehicle-edit",
      entityId: "id",
      rowClick: true,
    },
    {
      kind: "navigate",
      id: "wizard",
      icon: "list",
      label: "vehicles.action.wizard",
      screen: "vehicle-wizard",
      entityId: "id",
    },
  ],
  access: OPEN_ACCESS,
};

export const vehicleEditScreen: EntityEditScreenDefinition = {
  id: "vehicle-edit",
  type: "entityEdit",
  entity: "vehicle",
  listScreenId: "vehicle-list",
  submitLabel: "vehicles.action.saveChanges",
  layout: {
    sections: [
      {
        title: "vehicles.section.basics",
        description: "vehicles.section.basics.hint",
        columns: 2,
        fields: ["marke", "modell", "baujahr", "preis", "kilometerstand", "kilometerEinheit"],
      },
      {
        title: "vehicles.section.details",
        description: "vehicles.section.details.hint",
        columns: 2,
        fields: [...DETAIL_FIELDS],
      },
      {
        title: "vehicles.section.equipment",
        fields: ["ausstattung"],
      },
    ],
  },
  access: OPEN_ACCESS,
};

export const vehicleWizardScreen: EntityEditScreenDefinition = {
  id: "vehicle-wizard",
  type: "entityEdit",
  entity: "vehicle",
  dormant: true,
  listScreenId: "vehicle-list",
  description: "vehicles.wizard.description",
  layout: {
    mode: "wizard",
    sections: [
      { title: "vehicles.step.vinMatch", fields: ["fin"] },
      {
        title: "vehicles.step.basics",
        columns: 2,
        fields: ["marke", "modell", "baujahr", "preis"],
      },
      {
        title: "vehicles.step.vinDetails",
        columns: 2,
        fields: ["kilometerstand", "kilometerEinheit"],
      },
      {
        title: "vehicles.step.details",
        description: "vehicles.step.details.hint",
        columns: 2,
        fields: [...DETAIL_FIELDS],
      },
      { title: "vehicles.step.equipment", fields: ["ausstattung"] },
      { title: "vehicles.step.publish", fields: ["inserat"] },
    ],
  },
  access: OPEN_ACCESS,
};

export const campaignListScreen: EntityListScreenDefinition = {
  id: "campaign-list",
  type: "entityList",
  entity: "campaign",
  columns: ["name", "status", "meta", { field: "gestartetAm", hideOnNarrow: true }],
  searchPlaceholder: "vehicles.search.placeholder",
  defaultSort: { field: "gestartetAm", dir: "desc" },
  rowActions: [
    {
      kind: "navigate",
      id: "edit",
      label: "vehicles.action.edit",
      screen: "campaign-edit",
      entityId: "id",
      rowClick: true,
    },
  ],
  access: OPEN_ACCESS,
};

export const campaignEditScreen: EntityEditScreenDefinition = {
  id: "campaign-edit",
  type: "entityEdit",
  entity: "campaign",
  dormant: true,
  allowCreate: false,
  listScreenId: "campaign-list",
  layout: {
    sections: [{ columns: 2, fields: ["name", "status", "meta", "gestartetAm"] }],
  },
  access: OPEN_ACCESS,
};
