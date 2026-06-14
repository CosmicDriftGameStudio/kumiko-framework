import {
  access,
  createSystemConfig,
  createSystemSeed,
  createTenantConfig,
  createTenantSeed,
  createUserConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";

// Self-Populating Settings-Hub: jeder Key mit `mask` erscheint automatisch im
// Hub — kein r.screen/r.nav mehr. buildConfigFeatureSchema gruppiert nach Scope
// (Plattform/Organisation/Persönlich) und leitet Felder aus dem Key-Typ ab.
// mask.title ist der i18n-Key des Feld-Labels, mask.order die Reihenfolge.
export const configDemoFeature = defineFeature("config-demo", (r) => {
  r.requires("config");
  r.requires("secrets");

  r.config({
    keys: {
      siteName: createTenantConfig("text", {
        default: "My Site",
        read: access.all,
        write: access.all,
        mask: { title: "config-demo.site-name", order: 1 },
      }),
      themeColor: createTenantConfig("text", {
        default: "#000000",
        read: access.all,
        write: access.all,
        mask: { title: "config-demo.theme-color", order: 2 },
      }),
      maxUploadSize: createTenantConfig("number", {
        default: 10,
        bounds: { min: 1, max: 1000 },
        read: access.all,
        write: access.all,
        mask: { title: "config-demo.max-upload-size", order: 3 },
      }),
      emailNotifications: createUserConfig("boolean", {
        default: true,
        read: access.all,
        write: access.all,
        mask: { title: "config-demo.email-notifications", order: 1 },
      }),
      autoApprove: createSystemConfig("boolean", {
        default: false,
        read: access.all,
        write: access.systemAdmin,
        mask: { title: "config-demo.auto-approve", order: 1 },
      }),
    },
    seeds: {
      siteName: createTenantSeed({ value: "Config Demo" }),
      themeColor: createTenantSeed({ value: "#6366f1" }),
      maxUploadSize: createTenantSeed({ value: 50 }),
      autoApprove: createSystemSeed({ value: true }),
    },
  });
});
