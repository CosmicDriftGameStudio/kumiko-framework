// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { JOBS_FEATURE, JOB_RUN_DETAIL_SCREEN_ID, JOB_RUNS_SCREEN_ID } from "../constants";
import { JobRunDetailScreen } from "./job-run-detail-screen";
import { JobRunsScreen } from "./job-runs-screen";
import { defaultTranslations } from "./i18n";

export type JobsClientOptions = {
  readonly translations?: TranslationsByLocale;
};

export function jobsClient(options?: JobsClientOptions): ClientFeatureDefinition {
  return {
    name: JOBS_FEATURE,
    translations: mergeTranslations(defaultTranslations, options?.translations ?? {}),
    components: {
      [JOB_RUNS_SCREEN_ID]: JobRunsScreen,
      [JOB_RUN_DETAIL_SCREEN_ID]: JobRunDetailScreen,
    },
  };
}
