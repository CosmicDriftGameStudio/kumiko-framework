import {
  createDateField,
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

const DEMO_DATA = { personal: false, reason: "is_business_data" } as const;

export const LEASE_STATUSES = ["active", "terminated"] as const;

export const leaseEntity = createEntity({
  table: "read_ui_walkthrough_leases",
  fields: {
    mieter: createTextField({ ...DEMO_DATA, required: true, searchable: true, sortable: true }),
    einheit: createTextField({ ...DEMO_DATA, searchable: true, sortable: true, maxLength: 400 }),
    liegenschaft: createTextField({ ...DEMO_DATA, searchable: true, sortable: true }),
    beginn: createDateField({ required: true, sortable: true, filterable: true }),
    ende: createDateField({ sortable: true }),
    status: createSelectField({
      options: LEASE_STATUSES,
      optionTones: { active: "ok", terminated: "bad" },
      default: "active",
      required: true,
      sortable: true,
      filterable: true,
    }),
    grundmiete: createMoneyField({ required: true }),
    kuendigungsfrist: createTextField(DEMO_DATA),
    zahltag: createNumberField({ integer: true }),
  },
  defaultCurrency: "EUR",
});

export const leasePositionEntity = createEntity({
  table: "read_ui_walkthrough_lease_positions",
  fields: {
    lease: { type: "reference", entity: "lease", required: true, filterable: true },
    art: createTextField({ ...DEMO_DATA, required: true }),
    einheit: createTextField(DEMO_DATA),
    betrag: createMoneyField({ required: true }),
    gueltigVon: createDateField({ required: true, sortable: true }),
    gueltigBis: createDateField(),
  },
  defaultCurrency: "EUR",
});

export const leasePartyEntity = createEntity({
  table: "read_ui_walkthrough_lease_parties",
  fields: {
    lease: { type: "reference", entity: "lease", required: true, filterable: true },
    name: createTextField({ ...DEMO_DATA, required: true, searchable: true }),
    rolle: createTextField({ ...DEMO_DATA, filterable: true }),
  },
});
