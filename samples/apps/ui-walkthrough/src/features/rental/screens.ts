import {
  createDateField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  ActionFormScreenDefinition,
  DashboardScreenDefinition,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  ProjectionDetailScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { RENTAL_QUERIES, RENTAL_WRITES } from "./qualified-names";

const OPEN_ACCESS = {
  openToAll: {
    reason: "demo app: any signed-in user manages every lease; there is no per-user ownership",
  },
} as const;

const RENT_ADJUST_REASONS = ["indexmiete", "staffelmiete", "vereinbarung"] as const;

const OPEN_FILL_COLUMNS = [
  "mieter",
  "einheit",
  "liegenschaft",
  "beginn",
  "ende",
  "status",
] as const;

const openLeaseDetail = {
  kind: "navigate",
  id: "view",
  label: "rental.action.open",
  screen: "lease-detail",
  entityId: "id",
  rowClick: true,
} as const;

export const leaseListScreen: EntityListScreenDefinition = {
  id: "lease-list",
  type: "entityList",
  entity: "lease",
  columns: [...OPEN_FILL_COLUMNS],
  defaultSort: { field: "beginn", dir: "desc" },
  pageSize: 25,
  createLabel: "rental.action.createLease",
  searchPlaceholder: "rental.search.placeholder",
  rowActions: [openLeaseDetail],
  access: OPEN_ACCESS,
};

export const leaseListShortScreen: EntityListScreenDefinition = {
  id: "lease-list-short",
  type: "entityList",
  entity: "lease",
  columns: [...OPEN_FILL_COLUMNS],
  defaultSort: { field: "beginn", dir: "desc" },
  filter: { field: "status", op: "eq", value: "terminated" },
  pageSize: 25,
  dormant: true,
  rowActions: [openLeaseDetail],
  access: OPEN_ACCESS,
};

export const leaseEditScreen: EntityEditScreenDefinition = {
  id: "lease-edit",
  type: "entityEdit",
  entity: "lease",
  dormant: true,
  listScreenId: "lease-list",
  layout: {
    sections: [
      {
        columns: 2,
        fields: [
          "mieter",
          "einheit",
          "liegenschaft",
          "beginn",
          "ende",
          "status",
          "grundmiete",
          "kuendigungsfrist",
          "zahltag",
        ],
      },
    ],
  },
  access: OPEN_ACCESS,
};

export const positionEditScreen: EntityEditScreenDefinition = {
  id: "position-edit",
  type: "entityEdit",
  entity: "leasePosition",
  dormant: true,
  listScreenId: "lease-list",
  redirect: { screen: "lease-detail", idFrom: "lease" },
  layout: {
    sections: [
      {
        columns: 2,
        fields: [
          { field: "lease", visible: false },
          "art",
          "einheit",
          "betrag",
          "gueltigVon",
          "gueltigBis",
        ],
      },
    ],
  },
  access: OPEN_ACCESS,
};

const POSITION_COLUMNS = [
  { field: "art", label: "rental:entity:leasePosition:field:art" },
  { field: "einheit", label: "rental:entity:leasePosition:field:einheit" },
  { field: "betrag", label: "rental:entity:leasePosition:field:betrag", valueType: "money" },
  {
    field: "gueltigVon",
    label: "rental:entity:leasePosition:field:gueltigVon",
    sortable: true,
  },
  { field: "gueltigBis", label: "rental:entity:leasePosition:field:gueltigBis" },
] as const;

export const leaseDetailScreen: ProjectionDetailScreenDefinition = {
  id: "lease-detail",
  type: "projectionDetail",
  dormant: true,
  listScreenId: "lease-list",
  query: RENTAL_QUERIES.leaseAkte,
  header: {
    title: "mieter",
    subtitle: "standort",
    status: "statusLabel",
    statusTones: { Aktiv: "ok", Gekündigt: "bad" },
  },
  metrics: ["grundmiete", "beginn", "kuendigungsfrist", "zahltag", "mieter"],
  fieldLabels: {
    grundmiete: "rental:entity:lease:field:grundmiete",
    beginn: "rental:entity:lease:field:beginn",
    kuendigungsfrist: "rental:entity:lease:field:kuendigungsfrist",
    zahltag: "rental:entity:lease:field:zahltag",
    mieter: "rental:entity:lease:field:mieter",
    einheit: "rental:entity:lease:field:einheit",
    liegenschaft: "rental:entity:lease:field:liegenschaft",
    ende: "rental:entity:lease:field:ende",
    kontostand: "rental:entity:lease:field:kontostand",
    notizen: "rental:entity:lease:field:notizen",
  },
  layout: {
    mode: "tabs",
    sections: [
      {
        id: "parties",
        kind: "relatedList",
        title: "rental.tab.parties",
        query: RENTAL_QUERIES.partyList,
        parentFilter: { field: "lease" },
        countField: "partyCount",
        columns: [
          { field: "name", label: "rental:entity:leaseParty:field:name" },
          { field: "rolle", label: "rental:entity:leaseParty:field:rolle" },
        ],
      },
      {
        id: "positions",
        kind: "relatedList",
        title: "rental.tab.positions",
        query: RENTAL_QUERIES.positionList,
        countField: "positionCount",
        description: "rental.positions.description",
        itemNoun: "rental.positions.noun",
        columns: [...POSITION_COLUMNS],
        defaultSort: { field: "gueltigVon", dir: "desc" },
        toolbarActions: [
          {
            kind: "navigate",
            id: "add-position",
            label: "rental.action.addPosition",
            screen: "position-edit",
            params: { map: { lease: "id" } },
          },
        ],
        rowActions: [
          {
            kind: "drawer",
            id: "adjust-rent",
            icon: "pencil",
            label: "rental.action.adjustRent",
            screen: "adjust-rent",
            params: {
              map: {
                positionId: "id",
                art: "art",
                einheit: "einheit",
                einzelpreis: "betragWert",
                neuerBetrag: "betragWert",
                betrag: "betragWert",
                gueltigVon: "gueltigVonIso",
              },
            },
          },
        ],
      },
      {
        id: "account",
        kind: "fields",
        title: "rental.tab.account",
        fields: ["kontostand"],
      },
      {
        id: "contract-data",
        kind: "fields",
        title: "rental.tab.contractData",
        columns: 2,
        fields: ["einheit", "liegenschaft", "beginn", "ende"],
      },
      {
        id: "notes",
        kind: "fields",
        title: "rental.tab.notes",
        fields: ["notizen"],
      },
    ],
  },
  actions: [
    {
      kind: "writeHandler",
      id: "terminate",
      icon: "x",
      label: "rental.action.terminate",
      handler: RENTAL_WRITES.leaseTerminate,
      payload: { pick: ["id"] },
      confirm: "rental.action.terminateConfirm",
    },
    {
      kind: "navigate",
      id: "edit-lease",
      label: "rental.action.editLease",
      screen: "lease-edit",
      entityId: "id",
    },
  ],
  access: OPEN_ACCESS,
};

// Same record as lease-detail, but with a client component in the header slot
// and an extension tab, so the shell-header placement and the unframed
// extension tab are visible. Dormant: opened by URL (/lease-hub/<id>).
export const leaseHubScreen: ProjectionDetailScreenDefinition = {
  ...leaseDetailScreen,
  id: "lease-hub",
  slots: { header: { react: { __component: "LeaseHubHeader" } } },
  actions: [
    {
      kind: "navigate",
      id: "edit-lease",
      label: "rental.action.editLease",
      screen: "lease-edit",
      entityId: "id",
    },
  ],
  layout: {
    mode: "tabs",
    sections: [
      ...leaseDetailScreen.layout.sections.slice(0, 4),
      {
        id: "history",
        kind: "extension",
        title: "rental.tab.history",
        component: { react: { __component: "LeaseHubHistory" } },
        entityName: "lease",
      },
      ...leaseDetailScreen.layout.sections.slice(4),
    ],
  },
};

export const rentalDashboardScreen: DashboardScreenDefinition = {
  id: "rental-dashboard",
  type: "dashboard",
  panels: [
    {
      kind: "stat",
      id: "debt",
      label: "rental.dashboard.debt",
      query: RENTAL_QUERIES.kennzahlen,
      valueField: "debt",
      subField: "debtSub",
      deltaField: "debtDelta",
      deltaDirectionField: "debtDeltaDirection",
    },
    {
      kind: "stat",
      id: "rent",
      label: "rental.dashboard.rent",
      query: RENTAL_QUERIES.kennzahlen,
      valueField: "rent",
      subField: "rentSub",
    },
  ],
  access: OPEN_ACCESS,
};

export const adjustRentScreen: ActionFormScreenDefinition = {
  id: "adjust-rent",
  type: "actionForm",
  dormant: true,
  handler: RENTAL_WRITES.rentAdjust,
  fields: {
    positionId: createTextField({ personal: false, reason: "is_business_data", required: true }),
    wirksamAb: createDateField({ required: true }),
    art: createTextField({ personal: false, reason: "is_business_data" }),
    einheit: createTextField({ personal: false, reason: "is_business_data" }),
    betrag: { type: "money", currency: { kind: "literal", code: "EUR" } },
    gueltigVon: createDateField(),
    einzelpreis: { type: "money", required: true, currency: { kind: "literal", code: "EUR" } },
    neuerBetrag: { type: "money", required: true, currency: { kind: "literal", code: "EUR" } },
    begruendung: createSelectField({
      options: RENT_ADJUST_REASONS,
      display: "dropdown",
      default: "indexmiete",
      required: true,
    }),
  },
  fieldLabels: {
    positionId: "rental:entity:__action-form__:field:positionId",
    wirksamAb: "rental:entity:__action-form__:field:wirksamAb",
    art: "rental:entity:__action-form__:field:art",
    einheit: "rental:entity:__action-form__:field:einheit",
    betrag: "rental:entity:__action-form__:field:betrag",
    gueltigVon: "rental:entity:__action-form__:field:gueltigVon",
    einzelpreis: "rental:entity:__action-form__:field:einzelpreis",
    neuerBetrag: "rental:entity:__action-form__:field:neuerBetrag",
    begruendung: "rental:entity:__action-form__:field:begruendung",
  },
  layout: {
    sections: [
      {
        description: "rental.adjustRent.hint",
        fields: [
          { field: "positionId", visible: false },
          { field: "art", visible: false },
          { field: "einheit", visible: false },
          { field: "betrag", visible: false },
          { field: "gueltigVon", visible: false },
          "wirksamAb",
          "einzelpreis",
          "neuerBetrag",
          "begruendung",
        ],
      },
    ],
  },
  summary: {
    title: "rental.adjustRent.summary.title",
    subtitle: "rental.adjustRent.summary.subtitle",
  },
  access: OPEN_ACCESS,
};
