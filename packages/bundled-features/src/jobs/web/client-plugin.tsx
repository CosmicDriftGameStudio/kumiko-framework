// @runtime client
import { mergeTranslations, type TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ClientFeatureDefinition } from "@cosmicdrift/kumiko-renderer-web";
import { JOB_RUN_DETAIL_SCREEN_ID, JOB_RUNS_SCREEN_ID, JOBS_FEATURE } from "../constants";
import { defaultTranslations } from "./i18n";
import { JobRunDetailScreen } from "./job-run-detail-screen";
import { JobRunsScreen } from "./job-runs-screen";

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
