// Config-Stresstest (server). Die shadcn-Referenz-Designs NICHT handgebaut,
// sondern 1:1 aus dem Schema erzeugt — um zu sehen was die Auto-UI trägt und
// wo sie an Grenzen stößt. Erster Fall: "Shipping Address" (flache Form,
// 2-Felder-Reihen, Custom-Submit-Label).

import {
  createBooleanField,
  createDateField,
  createEntity,
  createImageField,
  createLocatedTimestampField,
  createSelectField,
  createTextField,
  createTimestampField,
  createTzField,
  defineFeature,
  registerEntityCrud,
} from "@cosmicdrift/kumiko-framework/engine";

type LocalizedString = { readonly de: string; readonly en: string };

// Server-Pendant zu web.ts — Boot-Validator braucht die required-i18n-Keys
// serverseitig registriert (SSR-Fallback + Boot-Check), unabhängig vom
// Client-Bundle. Werte identisch zu den client-seitigen Labels.
const EXAMPLES_I18N: Readonly<Record<string, LocalizedString>> = {
  "screen:shipping-edit.title": { de: "Lieferadresse", en: "Shipping Address" },
  "examples:shipping:submit": { de: "Adresse speichern", en: "Save Address" },
  "examples:entity:shipping:field:street": { de: "Straße", en: "Street address" },
  "examples:entity:shipping:field:apt": { de: "Wohnung / Suite", en: "Apt / Suite" },
  "examples:entity:shipping:field:city": { de: "Stadt", en: "City" },
  "examples:entity:shipping:field:state": { de: "Bundesland", en: "State" },
  "examples:entity:shipping:field:zip": { de: "PLZ", en: "ZIP Code" },
  "examples:entity:shipping:field:country": { de: "Land", en: "Country" },
  "examples:entity:shipping:field:saveAsDefault": {
    de: "Als Standardadresse speichern",
    en: "Save as default address",
  },
  "screen:profile-edit.title": { de: "Profil", en: "Profile" },
  "examples:profile:submit": { de: "Änderungen speichern", en: "Save changes" },
  "examples:entity:profile:field:avatar": { de: "Avatar", en: "Avatar" },
  "examples:entity:profile:field:fullName": { de: "Vollständiger Name", en: "Full name" },
  "examples:entity:profile:field:email": { de: "E-Mail", en: "Email" },
  "examples:entity:profile:field:bio": { de: "Bio", en: "Bio" },
  "screen:delivery-edit.title": { de: "Ort & Zeit", en: "Located date-time" },
  "examples:delivery:submit": { de: "Lieferung speichern", en: "Save delivery" },
  "examples:entity:delivery:field:label": { de: "Bezeichnung", en: "Label" },
  "examples:entity:delivery:field:pickup": {
    de: "Abholung (Uhrzeit + Zone)",
    en: "Pickup (wall-clock + zone)",
  },
  "examples:entity:delivery:field:dropoffOn": { de: "Abgabedatum", en: "Drop-off date" },
  "examples:entity:delivery:field:bookedAt": {
    de: "Gebucht am (UTC-Zeitpunkt)",
    en: "Booked at (UTC instant)",
  },
  "examples:entity:delivery:field:homeZone": { de: "Heimatzone Kurier", en: "Courier home zone" },
};

export const shippingEntity = createEntity({
  table: "read_examples_shipping",
  fields: {
    street: createTextField({ required: true }),
    apt: createTextField(),
    city: createTextField({ required: true }),
    state: createSelectField({
      options: ["California", "New York", "Texas", "Washington", "Florida"] as const,
    }),
    zip: createTextField({ required: true }),
    country: createSelectField({
      options: ["United States", "Germany", "United Kingdom", "Canada"] as const,
      default: "United States",
    }),
    saveAsDefault: createBooleanField({ default: false }),
  },
});

// Profile — testet das Avatar-Image-Upload-Feld (createImageField) in der
// Auto-Form: runde Preview + "Change"-Button, Upload an /api/files.
export const profileEntity = createEntity({
  table: "read_examples_profile",
  fields: {
    avatar: createImageField({ maxSize: "5mb", accept: ["jpg", "jpeg", "png"] }),
    fullName: createTextField({ required: true }),
    // Demo-Daten, kein echtes PII-Encryption-Setup → Plaintext bewusst erlaubt.
    email: createTextField({ required: true, allowPlaintext: "is-business-data" }),
    bio: createTextField({ multiline: { rows: 3 } }),
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
    label: createTextField({ required: true }),
    pickup: createLocatedTimestampField({ required: true }),
    dropoffOn: createDateField(),
    bookedAt: createTimestampField(),
    homeZone: createTzField(),
  },
});

const open = { access: { openToAll: true } } as const;
const editFormOnly = {
  write: open,
  read: open,
  verbs: { delete: false, list: false, restore: false },
} as const;

export const examplesFeature = defineFeature("examples", (r) => {
  r.translations({ keys: EXAMPLES_I18N });
  registerEntityCrud(r, "shipping", shippingEntity, editFormOnly);

  // EINE titellose Section: Card-Titel + Subtitle (aus i18n) tragen den
  // Kontext, die Felder fließen direkt darunter. street/apt/saveAsDefault
  // spannen beide Spalten (volle Breite), city/state + zip/country teilen
  // sich je eine Reihe.
  r.screen({
    id: "shipping-edit",
    type: "entityEdit",
    entity: "shipping",
    submitLabel: "examples:shipping:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [
            { field: "street", span: 2 },
            { field: "apt", span: 2 },
            "city",
            "state",
            "zip",
            "country",
            { field: "saveAsDefault", span: 2 },
          ],
        },
      ],
    },
  });

  registerEntityCrud(r, "profile", profileEntity, editFormOnly);

  r.screen({
    id: "profile-edit",
    type: "entityEdit",
    entity: "profile",
    submitLabel: "examples:profile:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [{ field: "avatar", span: 2 }, "fullName", "email", { field: "bio", span: 2 }],
        },
      ],
    },
  });

  registerEntityCrud(r, "delivery", deliveryEntity, editFormOnly);

  r.screen({
    id: "delivery-edit",
    type: "entityEdit",
    entity: "delivery",
    submitLabel: "examples:delivery:submit",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [
            { field: "label", span: 2 },
            { field: "pickup", span: 2 },
            "dropoffOn",
            "homeZone",
            { field: "bookedAt", span: 2 },
          ],
        },
      ],
    },
  });

  r.nav({ id: "examples", label: "Examples", order: 30 });
  r.nav({
    id: "shipping",
    label: "Shipping address",
    parent: "examples:nav:examples",
    screen: "examples:screen:shipping-edit",
    icon: "file",
    order: 10,
  });
  r.nav({
    id: "profile",
    label: "Profile",
    parent: "examples:nav:examples",
    screen: "examples:screen:profile-edit",
    icon: "file",
    order: 20,
  });
  r.nav({
    id: "delivery",
    label: "Located date-time",
    parent: "examples:nav:examples",
    screen: "examples:screen:delivery-edit",
    icon: "file",
    order: 30,
  });
});
