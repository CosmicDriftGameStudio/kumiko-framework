import { describe, expect, test } from "bun:test";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { createChannelDiscordFeature } from "../../channel-discord/feature.ts";
import { createChannelSlackFeature } from "../../channel-slack/feature.ts";
import { createChannelTeamsFeature } from "../../channel-teams/feature.ts";

type ProviderCase = {
  readonly feature: FeatureDefinition;
  readonly featureName: string;
  readonly channelName: string;
  readonly displayLabel: string;
  readonly translation: string;
  readonly label: { readonly en: string; readonly de: string; readonly es: string };
  readonly hint: { readonly en: string; readonly de: string; readonly es: string };
};

const cases: readonly ProviderCase[] = [
  {
    feature: createChannelSlackFeature(),
    featureName: "channel-slack",
    channelName: "slack",
    displayLabel: "Slack Channel",
    translation: "Slack",
    label: { en: "Slack webhooks", de: "Slack-Webhooks", es: "Webhooks de Slack" },
    hint: {
      en: 'One secret per connection name; the value is the Slack webhook URL. Address it with route: { slack: "<connection name>" }.',
      de: 'Ein Secret pro Verbindungsname; der Wert ist die Slack-Webhook-URL. Adressierung mit route: { slack: "<Verbindungsname>" }.',
      es: 'Un secreto por nombre de conexión; el valor es la URL del webhook de Slack. Se usa con route: { slack: "<nombre de conexión>" }.',
    },
  },
  {
    feature: createChannelDiscordFeature(),
    featureName: "channel-discord",
    channelName: "discord",
    displayLabel: "Discord Channel",
    translation: "Discord",
    label: { en: "Discord webhooks", de: "Discord-Webhooks", es: "Webhooks de Discord" },
    hint: {
      en: 'One secret per connection name; the value is the Discord webhook URL. Address it with route: { discord: "<connection name>" }.',
      de: 'Ein Secret pro Verbindungsname; der Wert ist die Discord-Webhook-URL. Adressierung mit route: { discord: "<Verbindungsname>" }.',
      es: 'Un secreto por nombre de conexión; el valor es la URL del webhook de Discord. Se usa con route: { discord: "<nombre de conexión>" }.',
    },
  },
  {
    feature: createChannelTeamsFeature(),
    featureName: "channel-teams",
    channelName: "teams",
    displayLabel: "Microsoft Teams Channel",
    translation: "Microsoft Teams",
    label: {
      en: "Microsoft Teams webhooks",
      de: "Microsoft Teams-Webhooks",
      es: "Webhooks de Microsoft Teams",
    },
    hint: {
      en: 'One secret per connection name; the value is the Microsoft Teams webhook URL. Address it with route: { teams: "<connection name>" }.',
      de: 'Ein Secret pro Verbindungsname; der Wert ist die Microsoft Teams-Webhook-URL. Adressierung mit route: { teams: "<Verbindungsname>" }.',
      es: 'Un secreto por nombre de conexión; el valor es la URL del webhook de Microsoft Teams. Se usa con route: { teams: "<nombre de conexión>" }.',
    },
  },
];

describe("chat webhook feature registration", () => {
  for (const c of cases) {
    describe(c.featureName, () => {
      test("registers name, requirements and ui hints", () => {
        expect(c.feature.name).toBe(c.featureName);
        expect(c.feature.requires).toContain("delivery");
        expect(c.feature.requires).toContain("secrets");
        expect(c.feature.uiHints?.displayLabel).toBe(c.displayLabel);
      });

      test("registers the tenant webhooks secret namespace", () => {
        const namespace = c.feature.secretNamespaces["webhooks"];
        expect(namespace?.scope).toBe("tenant");
        expect(namespace?.label).toEqual(c.label);
        expect(namespace?.hint).toEqual(c.hint);
      });

      test("registers exactly one delivery channel extension usage", () => {
        expect(c.feature.extensionUsages).toHaveLength(1);
        const usage = c.feature.extensionUsages[0];
        expect(usage?.extensionName).toBe("deliveryChannel");
        expect(usage?.entityName).toBe(c.channelName);
        expect(usage?.options?.["addressKind"]).toBe("connection-name");
        expect(usage?.options?.["mode"]).toBe("queued");
      });

      test("registers the channel translation", () => {
        expect(c.feature.translations[`delivery.channel.${c.channelName}`]).toEqual({
          en: c.translation,
        });
      });
    });
  }

  test("discord webhook secret value must use the webhooks path prefix", () => {
    const discord = cases[1]?.feature.secretNamespaces["webhooks"];
    expect(discord?.valueSchema?.safeParse("https://discord.com/foo").success).toBe(false);
    expect(discord?.valueSchema?.safeParse("https://discord.com/api/webhooks/1/abc").success).toBe(
      true,
    );
  });
});
