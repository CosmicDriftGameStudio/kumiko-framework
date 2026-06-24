import { access, defineEntityListHandler } from "@cosmicdrift/kumiko-framework/engine";
import { downloadAttemptEntity } from "../schema/download-attempt";

// SystemAdmin operator view of invalid download attempts (DPO brute-force
// triage). A bespoke list-download-attempts query already exists but sits on a
// non-convention QN; entityList needs the convention `download-attempt:list`.
export const downloadAttemptListQuery = defineEntityListHandler(
  "download-attempt",
  downloadAttemptEntity,
  { access: { roles: access.systemAdmin } },
);
