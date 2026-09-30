import {
  createEntity,
  createMoneyField,
  createNumberField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";

const DEMO_DATA = { personal: false, reason: "is_business_data" } as const;

export const MILEAGE_UNITS = ["mi", "km"] as const;
export const FUEL_TYPES = ["diesel", "petrol", "electric", "hybrid"] as const;
export const TRANSMISSIONS = ["manual", "automatic"] as const;
export const BODY_STYLES = ["estate", "sedan", "hatchback", "suv"] as const;
export const CONDITIONS = ["new", "used", "accident"] as const;
export const SERVICE_BOOKS = ["complete", "partial", "none"] as const;
export const LISTING_STATES = ["draft", "published"] as const;
export const CAMPAIGN_STATUSES = ["aktiv", "abgeschlossen", "entwurf"] as const;

export const vehicleEntity = createEntity({
  table: "read_ui_walkthrough_vehicles",
  fields: {
    fin: createTextField({ ...DEMO_DATA, maxLength: 17 }),
    marke: createTextField({ ...DEMO_DATA, required: true, searchable: true, sortable: true }),
    modell: createTextField({ ...DEMO_DATA, required: true, searchable: true, sortable: true }),
    baujahr: createNumberField({ integer: true, sortable: true }),
    preis: createMoneyField({ sortable: true }),
    kilometerstand: createNumberField({ integer: true }),
    kilometerEinheit: createSelectField({ options: MILEAGE_UNITS, default: "km" }),
    kraftstoffart: createSelectField({ options: FUEL_TYPES }),
    getriebe: createSelectField({ options: TRANSMISSIONS }),
    leistungKw: createNumberField({ integer: true }),
    karosserieform: createSelectField({ options: BODY_STYLES }),
    ausstattungslinie: createTextField(DEMO_DATA),
    zustand: createSelectField({ options: CONDITIONS, filterable: true }),
    vorbesitzer: createNumberField({ integer: true }),
    garantieMonate: createNumberField({ integer: true }),
    scheckheft: createSelectField({ options: SERVICE_BOOKS }),
    beschreibung: createTextField({ ...DEMO_DATA, multiline: { rows: 6 }, maxLength: 2000 }),
    ausstattung: createTextField(DEMO_DATA),
    inserat: createSelectField({ options: LISTING_STATES, default: "draft" }),
  },
  defaultCurrency: "EUR",
});

export const campaignEntity = createEntity({
  table: "read_ui_walkthrough_campaigns",
  fields: {
    name: createTextField({ ...DEMO_DATA, required: true, searchable: true, sortable: true }),
    status: createSelectField({ options: CAMPAIGN_STATUSES, required: true }),
    meta: createTextField(DEMO_DATA),
  },
});
