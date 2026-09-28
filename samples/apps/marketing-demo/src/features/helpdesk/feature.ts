// Helpdesk-Feature — Server-Side. Zweite Demo-App neben Assets,
// gleiches Framework-Pattern, andere Domain.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import type { TranslationValue } from "@cosmicdrift/kumiko-framework/ui-types";
import { helpdeskTranslations } from "./i18n";
import { ticketEditScreen, ticketEntity, ticketListScreen } from "./schema";

const openReason =
  "demo app: any signed-in user manages every helpdesk ticket; there is no per-user ownership in this sample";

const openRead = { access: { openToAll: { reason: openReason } } } as const;

const openWrite = {
  access: { openToAll: { reason: openReason, personalData: "tenant-members" } },
} as const;

// r.translations() wants key-first shape ({key: {de, en}}); helpdeskTranslations
// is locale-first (client TranslationsByLocale shape) — invert here (bracket
// notation + fallback avoids TS4111/TS18048 under noUncheckedIndexedAccess).
const REQUIRED_I18N: Record<string, { de: TranslationValue; en: TranslationValue }> =
  Object.fromEntries(
    Object.keys(helpdeskTranslations["de"] ?? {}).map((key) => [
      key,
      { de: helpdeskTranslations["de"]?.[key] ?? "", en: helpdeskTranslations["en"]?.[key] ?? "" },
    ]),
  );

export const helpdeskFeature = defineFeature("helpdesk", (r) => {
  r.translations({ keys: REQUIRED_I18N });

  r.crud("ticket", ticketEntity, { write: openWrite, read: openRead });

  r.screen(ticketEditScreen);
  r.screen(ticketListScreen);

  r.nav({
    id: "helpdesk",
    label: "helpdesk:nav.list",
    icon: "mail",
    order: 20,
    screen: "helpdesk:screen:ticket-list",
  });
  r.nav({
    id: "ticket-new",
    label: "helpdesk:nav.new",
    icon: "plus",
    parent: "helpdesk:nav:helpdesk",
    screen: "helpdesk:screen:ticket-edit",
    order: 10,
  });
});
