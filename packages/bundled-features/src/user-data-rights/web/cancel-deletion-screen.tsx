// CancelAccountDeletionScreen — anonymous screen behind the cancel link of the
// deletion-requested mail (a requested account cannot sign in). Reads the token
// from the URL fragment (`#token=…`) and dispatches
// user-data-rights:write:cancel-deletion-by-token on click.
//
// The app mounts this screen at the deletionCancelUrl route via
// makePublicDeletionGate's cancelPath.

import type { ReactNode } from "react";
import { UserDataRightsHandlers } from "./constants.ts";
import { DeletionTokenScreen, type DeletionTokenScreenCopy } from "./deletion-token-screen.tsx";

const CANCEL_COPY: DeletionTokenScreenCopy = {
  title: "userDataRights.deletion.cancel.title",
  intro: "userDataRights.deletion.cancel.intro",
  submit: "userDataRights.deletion.cancel.submit",
  submitting: "userDataRights.deletion.cancel.submitting",
  successTitle: "userDataRights.deletion.cancel.successTitle",
  successBody: "userDataRights.deletion.cancel.successBody",
  invalidToken: "userDataRights.deletion.cancel.invalidToken",
  missingToken: "userDataRights.deletion.cancel.missingToken",
  error: "userDataRights.deletion.cancel.error",
};

export type CancelAccountDeletionScreenProps = {
  readonly title?: string;
};

export function CancelAccountDeletionScreen({
  title,
}: CancelAccountDeletionScreenProps): ReactNode {
  return (
    <DeletionTokenScreen
      handler={UserDataRightsHandlers.cancelDeletionByToken}
      copy={CANCEL_COPY}
      submitVariant="primary"
      title={title}
    />
  );
}
