import {
  defineFeature,
  EXT_USER_DATA,
  type FeatureDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import { WAITLIST_FEATURE } from "./constants.js";
import { waitlistEntryEntity } from "./entity.js";
import { createInviteHandler } from "./handlers/invite.write.js";
import { listQuery } from "./handlers/list.query.js";
import { rejectHandler } from "./handlers/reject.write.js";
import { createSubmitHandler } from "./handlers/submit.write.js";
import { WAITLIST_I18N } from "./i18n.js";
import { adminAccess } from "./lib.js";
import type { WaitlistOptions } from "./options.js";
import { waitlistListScreen } from "./screens.js";
import { waitlistEntryDeleteHook, waitlistEntryExportHook } from "./user-data-hooks.js";

export function createWaitlistFeature(opts: WaitlistOptions = {}): FeatureDefinition {
  return defineFeature(WAITLIST_FEATURE, (r) => {
    r.describe(
      "Public waitlist: an anonymous, rate-limited `submit` handler collects name, email and optional company, portfolio and message (a honeypot field and per-email dedupe keep bots and repeat submits out, and the response never reveals whether an address was already listed), and mails the submitter a confirmation. SystemAdmins review entries in a list screen and invite or reject them; an invite creates the entrant's own tenant (or joins one shared tenant) and mails an accept link with the configured membership role, never a global role. Entries are platform-wide, their personal data is crypto-shredding-ready, and the EXT_USER_DATA hooks export and erase entries matching a user's email.",
    );
    r.uiHints({ displayLabel: "Waitlist", category: "data", recommended: false });
    r.systemScope();
    r.requires("tenant", "auth-email-password", "user-data-rights");
    r.translations({ keys: WAITLIST_I18N });

    r.entity("waitlistEntry", waitlistEntryEntity);
    r.writeHandler(createSubmitHandler(opts));
    r.writeHandler(createInviteHandler(opts.invite));
    r.writeHandler(rejectHandler);
    r.queryHandler(listQuery);

    r.screen(waitlistListScreen);
    r.nav({
      id: "waitlist",
      label: i18nKey("waitlist.nav.waitlist"),
      screen: "waitlist:screen:waitlist-list",
      icon: "users",
      order: 15,
      access: adminAccess,
    });

    r.useExtension(EXT_USER_DATA, "waitlistEntry", {
      export: waitlistEntryExportHook,
      delete: waitlistEntryDeleteHook,
    });
  });
}
