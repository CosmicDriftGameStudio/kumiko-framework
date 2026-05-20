import {
  access,
  createBooleanField,
  createNumberField,
  createSystemConfig,
  createSystemSeed,
  createTenantConfig,
  createTenantSeed,
  createTextField,
  createUserConfig,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ConfigEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";

const settingsScreen: ConfigEditScreenDefinition = {
  id: "settings",
  type: "configEdit",
  scope: "tenant",
  configKeys: {
    siteName: "config-demo:config:site-name",
    themeColor: "config-demo:config:theme-color",
    maxUploadSize: "config-demo:config:max-upload-size",
    emailNotifications: "config-demo:config:email-notifications",
    autoApprove: "config-demo:config:auto-approve",
  },
  fields: {
    siteName: createTextField({}),
    themeColor: createTextField({}),
    maxUploadSize: createNumberField({}),
    emailNotifications: createBooleanField({}),
    autoApprove: createBooleanField({}),
  },
  layout: {
    sections: [
      {
        title: "config-demo:section.general",
        columns: 2,
        fields: ["siteName", "themeColor", "maxUploadSize"],
      },
      {
        title: "config-demo:section.features",
        columns: 2,
        fields: ["emailNotifications", "autoApprove"],
      },
    ],
  },
  access: { openToAll: true },
};

export const configDemoFeature = defineFeature("config-demo", (r) => {
  r.requires("config");
  r.requires("secrets");

  r.config({
    keys: {
      siteName: createTenantConfig("text", {
        default: "My Site",
        read: access.all,
        write: access.all,
      }),
      themeColor: createTenantConfig("text", {
        default: "#000000",
        read: access.all,
        write: access.all,
      }),
      maxUploadSize: createTenantConfig("number", {
        default: 10,
        bounds: { min: 1, max: 1000 },
        read: access.all,
        write: access.all,
      }),
      emailNotifications: createUserConfig("boolean", {
        default: true,
        read: access.all,
        write: access.all,
      }),
      autoApprove: createSystemConfig("boolean", {
        default: false,
        read: access.all,
        write: access.systemAdmin,
      }),
    },
    seeds: {
      siteName: createTenantSeed({ value: "Config Demo" }),
      themeColor: createTenantSeed({ value: "#6366f1" }),
      maxUploadSize: createTenantSeed({ value: 50 }),
      autoApprove: createSystemSeed({ value: true }),
    },
  });

  r.screen(settingsScreen);
  r.nav({ id: "settings", label: "config-demo:nav.settings", screen: "settings", order: 10 });
});
