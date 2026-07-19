import type { TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { WIDGETS_I18N } from "../i18n";
import { DashboardFilterEcho } from "./DashboardFilterEcho";
import { DashboardKpiIcon } from "./DashboardKpiIcon";
import { Widgets } from "./Widgets";

// Client pivot of WIDGETS_I18N (key-first) — same keys as the server
// r.translations() bundle. Without this, panel labels like
// "widgets:dashboard:response-times" render as the raw key client-side
// (the boot validator only checks the server-side bundle).
const LOCALES = ["de", "en"] as const;

const translations: TranslationsByLocale = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    Object.fromEntries(Object.entries(WIDGETS_I18N).map(([key, value]) => [key, value[locale]])),
  ]),
);

export const widgetsClient: ClientFeatureDefinition = {
  name: "widgets",
  components: { widgets: Widgets },
  extensionSectionComponents: {
    "widgets-dashboard-filter-echo": DashboardFilterEcho,
    "widgets-dashboard-kpi-icon": DashboardKpiIcon,
  },
  translations,
};
