import { AUDIT_FEATURE } from "./audit/index.ts";
import { CAP_COUNTER_FEATURE } from "./cap-counter/index.ts";
import { CAP_OVERVIEW_FEATURE } from "./cap-overview/index.ts";
import { DELIVERY_FEATURE } from "./delivery/index.ts";
import { FEATURE_TOGGLES_FEATURE } from "./feature-toggles/index.ts";
import { INBOUND_MAIL_FOUNDATION_FEATURE } from "./inbound-mail-foundation/index.ts";
import { JOBS_FEATURE } from "./jobs/index.ts";
import { MANAGED_PAGES_FEATURE } from "./managed-pages/index.ts";
import { PAT_FEATURE } from "./personal-access-tokens/index.ts";
import { SESSIONS_FEATURE } from "./sessions/index.ts";
import { TAGS_FEATURE_NAME } from "./tags/index.ts";
import { TENANT_FEATURE } from "./tenant/index.ts";
import { USER_FEATURE } from "./user/index.ts";
import { USER_DATA_RIGHTS_FEATURE } from "./user-data-rights/index.ts";
import { WAITLIST_FEATURE } from "./waitlist/index.ts";

/** Bundled features that ship entityList, projectionList or relatedList screens; `bundledLists` in composeFeatures applies its table block to exactly these. */
export const BUNDLED_LIST_FEATURE_NAMES = [
  AUDIT_FEATURE,
  CAP_COUNTER_FEATURE,
  CAP_OVERVIEW_FEATURE,
  DELIVERY_FEATURE,
  FEATURE_TOGGLES_FEATURE,
  INBOUND_MAIL_FOUNDATION_FEATURE,
  JOBS_FEATURE,
  MANAGED_PAGES_FEATURE,
  PAT_FEATURE,
  SESSIONS_FEATURE,
  TAGS_FEATURE_NAME,
  TENANT_FEATURE,
  USER_FEATURE,
  USER_DATA_RIGHTS_FEATURE,
  WAITLIST_FEATURE,
] as const;
