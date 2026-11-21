// ConfirmAccountDeletionScreen — anonymous Apex screen, step 2. Reads the
// token from the URL fragment (`#token=…`, never sent to the server, so it does
// not appear in proxy/access logs) and dispatches
// user-data-rights:write:confirm-deletion-by-token on confirmation to start the
// grace period.
//
// The app mounts this screen at the deletionVerifyUrl route (for example,
// /delete-account/confirm) via createPublicSurface.

import type { ReactNode } from "react";
import { UserDataRightsHandlers } from "./constants.ts";
import { DeletionTokenScreen, type DeletionTokenScreenCopy } from "./deletion-token-screen.tsx";

const CONFIRM_COPY: DeletionTokenScreenCopy = {
  title: "userDataRights.deletion.confirm.title",
  intro: "userDataRights.deletion.confirm.intro",
  submit: "userDataRights.deletion.confirm.submit",
  submitting: "userDataRights.deletion.confirm.submitting",
  successTitle: "userDataRights.deletion.confirm.successTitle",
  successBody: "userDataRights.deletion.confirm.successBody",
  invalidToken: "userDataRights.deletion.confirm.invalidToken",
  missingToken: "userDataRights.deletion.confirm.missingToken",
  error: "userDataRights.deletion.confirm.error",
};

export type ConfirmAccountDeletionScreenProps = {
  readonly title?: string;
};

export function ConfirmAccountDeletionScreen({
  title,
}: ConfirmAccountDeletionScreenProps): ReactNode {
  return (
    <DeletionTokenScreen
      handler={UserDataRightsHandlers.confirmDeletionByToken}
      copy={CONFIRM_COPY}
      submitVariant="danger"
      title={title}
    />
  );
}
