// Tasks-Feature — Web-Plattform-Plugin. Heute nur Translations,
// keine Custom-Components.

import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { tasksTranslations } from "../i18n";

export const tasksClient: ClientFeatureDefinition = {
  name: "ui-walkthrough",
  translations: tasksTranslations,
};
