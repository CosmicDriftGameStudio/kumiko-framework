import { type EntityListScreenDefinition, i18nKey } from "@cosmicdrift/kumiko-framework/engine";
import { WAITLIST_STATUS, WaitlistHandlers } from "./constants.js";
import { adminAccess } from "./lib.js";

export const waitlistListScreen: EntityListScreenDefinition = {
  id: "waitlist-list",
  type: "entityList",
  entity: "waitlistEntry",
  columns: ["name", "email", "company", "status", "locale", "submittedAt"],
  defaultSort: { field: "submittedAt", dir: "desc" },
  access: adminAccess,
  searchable: true,
  rowActions: [
    {
      id: "invite",
      label: i18nKey("waitlist.action.invite"),
      handler: WaitlistHandlers.invite,
      visible: { field: "status", eq: WAITLIST_STATUS.Pending },
    },
    {
      id: "re-invite",
      label: i18nKey("waitlist.action.reInvite"),
      handler: WaitlistHandlers.invite,
      visible: { field: "status", eq: WAITLIST_STATUS.Invited },
    },
    {
      id: "reject",
      label: i18nKey("waitlist.action.reject"),
      handler: WaitlistHandlers.reject,
      confirm: i18nKey("waitlist.action.reject.confirm"),
      style: "danger",
      visible: { field: "status", eq: WAITLIST_STATUS.Pending },
    },
    {
      id: "reject-invited",
      label: i18nKey("waitlist.action.reject"),
      handler: WaitlistHandlers.reject,
      confirm: i18nKey("waitlist.action.reject.confirm"),
      style: "danger",
      visible: { field: "status", eq: WAITLIST_STATUS.Invited },
    },
  ],
};
