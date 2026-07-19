// Helpdesk-Feature — Server-Side. Zweite Demo-App neben Assets,
// gleiches Framework-Pattern, andere Domain.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { helpdeskTranslations } from "./i18n";
import { ticketEditScreen, ticketEntity, ticketListScreen } from "./schema";

const open = { access: { openToAll: true } } as const;

// r.translations() wants key-first shape ({key: {de, en}}); helpdeskTranslations
// is locale-first (client TranslationsByLocale shape) — invert here (bracket
// notation + fallback avoids TS4111/TS18048 under noUncheckedIndexedAccess).
const REQUIRED_I18N: Record<string, { de: string; en: string }> = Object.fromEntries(
  Object.keys(helpdeskTranslations["de"] ?? {}).map((key) => [
    key,
    { de: helpdeskTranslations["de"]?.[key] ?? "", en: helpdeskTranslations["en"]?.[key] ?? "" },
  ]),
);

export const helpdeskFeature = defineFeature("helpdesk", (r) => {
  r.translations({ keys: REQUIRED_I18N });

  r.crud("ticket", ticketEntity, { write: open, read: open });

  r.screen(ticketEditScreen);
  r.screen(ticketListScreen);

  r.nav({
    id: "helpdesk",
    label: "helpdesk:nav.list",
    order: 20,
    screen: "helpdesk:screen:ticket-list",
  });
  r.nav({
    id: "ticket-new",
    label: "helpdesk:nav.new",
    parent: "helpdesk:nav:helpdesk",
    screen: "helpdesk:screen:ticket-edit",
    order: 10,
  });
});
