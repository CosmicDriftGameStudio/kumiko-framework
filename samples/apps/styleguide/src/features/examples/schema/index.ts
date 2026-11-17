import {
  createBooleanField,
  createDateField,
  createEmbeddedListField,
  createEntity,
  createImageField,
  createLocatedTimestampField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
} from "@cosmicdrift/kumiko-framework/engine";

export const shippingEntity = createEntity({
  table: "read_examples_shipping",
  fields: {
    street: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    apt: createTextField({ personal: { of: "id" }, find: "none" }),
    city: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    state: createSelectField({
      options: ["California", "New York", "Texas", "Washington", "Florida"] as const,
    }),
    zip: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    country: createSelectField({
      options: ["United States", "Germany", "United Kingdom", "Canada"] as const,
      default: "United States",
    }),
    saveAsDefault: createBooleanField({ default: false }),
  },
});

// Profile — testet das Avatar-Image-Upload-Feld (createImageField) in der
// Auto-Form: rechteckige Preview + "Change"-Button, Upload an /api/files.
export const profileEntity = createEntity({
  table: "read_examples_profile",
  fields: {
    avatar: createImageField({ maxSize: "5mb", accept: ["jpg", "jpeg", "png"] }),
    fullName: createTextField({ personal: { of: "id" }, find: "none", required: true }),
    // Demo-Daten, kein echtes PII-Encryption-Setup → Plaintext bewusst erlaubt.
    email: createTextField({
      required: true,
      personal: false,
      reason: "is_business_data",
      sortable: true,
    }),
    bio: createTextField({ personal: { of: "id" }, find: "none", multiline: { rows: 3 } }),
  },
});

// Delivery — der locatedTimestamp-Picker (Wall-Clock + IANA-Zone, item 10) in
// der Auto-Form. Spiegelt die timezones-Recipe-Entity 1:1 (pickup/dropoffOn/
// bookedAt/homeZone), damit der Docs-Screenshot den eingebetteten Recipe-Code
// zeigt. `pickup` rendert als kombinierter Date-Time + Zone-Picker, die andern
// drei Zeit-Feldtypen als ihre jeweilige Auto-UI-Kontrolle.
export const deliveryEntity = createEntity({
  table: "read_examples_delivery",
  fields: {
    label: createTextField({ personal: false, reason: "is_business_data", required: true }),
    pickup: createLocatedTimestampField({ required: true }),
    dropoffOn: createDateField(),
    bookedAt: createTimestampField(),
    homeZone: createTzField(),
  },
});

// Inspection — the inspection-checklist recipe's protocol (sub-fields, derived result,
// conditions), rendered as the phone checklist in the auto-form.
const isMeasurement = { field: "kind", eq: "measurement" } as const;
const isNotOk = { field: "result", eq: "not_ok" } as const;

export const inspectionEntity = createEntity({
  table: "read_examples_inspection",
  fields: {
    measuringDevice: createTextField({ personal: false, reason: "is_business_data" }),
    checkpoints: createEmbeddedListField(
      {
        label: { type: "text", required: true },
        kind: { type: "select", options: ["check", "measurement"], required: true },
        min: { type: "number", visibleWhen: isMeasurement },
        max: { type: "number", visibleWhen: isMeasurement },
        measured: { type: "number", visibleWhen: isMeasurement },
        result: {
          type: "select",
          options: ["ok", "not_ok"],
          display: "radio",
          optionTones: { ok: "ok", not_ok: "bad" },
        },
        finding: { type: "text", visibleWhen: isNotOk, requiredWhen: isNotOk },
        photos: {
          type: "images",
          capture: "environment",
          maxCount: 5,
          visibleWhen: isNotOk,
          requiredWhen: isNotOk,
        },
      },
      {
        personal: false,
        reason: "is_business_data",
        derived: {
          result: {
            op: "inRange",
            from: ["measured", "min", "max"],
            inside: "ok",
            outside: "not_ok",
            when: isMeasurement,
          },
        },
      },
    ),
    continuedOperation: createSelectField({
      options: ["yes", "with_condition", "no"],
      display: "radio",
      optionTones: { yes: "ok", with_condition: "warn", no: "bad" },
    }),
    condition: createTextField({
      personal: false,
      reason: "is_business_data",
      visibleWhen: { field: "continuedOperation", eq: "with_condition" },
      requiredWhen: { field: "continuedOperation", eq: "with_condition" },
    }),
  },
});
