import type { BootRuleTable } from "./boot-rule.ts";

export const SCREEN_ACTION_RULES = {
  actionIcon: {
    id: "screen/action-icon",
    summary: "Every screen action resolves to a registered icon.",
    fix: "Set icon to a registered NAV_ICONS key or use an action id that resolves one via the default icon map.",
  },
  rowClickAtMostOne: {
    id: "screen/row-click-at-most-one",
    summary: "At most one row-body click target (rowClick) is declared per list.",
    fix: "Mark at most one rowAction with rowClick: true.",
  },
  navigateParamsDashboardNoReader: {
    id: "screen/navigate-params-dashboard-no-reader",
    summary:
      "A navigate action with params targets a dashboard that declares a filter, time range or record binding.",
    fix: "Remove the params extractor, or add a filter (or record binding) to the target dashboard.",
  },
  navigateParamsDashboardKeyMismatch: {
    id: "screen/navigate-params-dashboard-key-mismatch",
    summary:
      "Navigate params extract at least one key the target dashboard reads (filter id, time range id or record param).",
    fix: "Fix the params extractor to produce one of the dashboard's read keys, or remove it.",
  },
  navigateParamsTargetIgnoresParams: {
    id: "screen/navigate-params-target-ignores-params",
    summary:
      "Navigate params only target screens that read URL search params as initial values (actionForm, secretMint, entityEdit-create).",
    fix: "Remove the params extractor or retarget to an actionForm, secretMint or cross-entity entityEdit-create screen.",
  },
  actionUnknownFieldRef: {
    id: "screen/action-unknown-field-ref",
    summary: "Action payload and params extractors reference existing entity fields.",
    fix: "Name a known field in the pick/map extractor.",
  },
  actionVisibleUnknownField: {
    id: "screen/action-visible-unknown-field",
    summary: "An action's visible.field references an existing entity field.",
    fix: "Point visible.field at a known field.",
  },
  actionEntityIdUnknownField: {
    id: "screen/action-entity-id-unknown-field",
    summary: "An action's entityId references an existing entity field or the id column.",
    fix: "Point entityId at a known field.",
  },
  screenShortIdCollision: {
    id: "screen/short-id-collision",
    summary: "A screen short id is registered by at most one feature.",
    fix: "Give each screen a distinct id.",
  },
  navTargetUnresolved: {
    id: "screen/nav-target-unresolved",
    summary: "A redirect, cancelTarget, success link or fallback resolves to a registered screen.",
    fix: "Use the id of a screen in this feature or a fully-qualified <feature>:screen:<id>.",
  },
  drawerTargetUnresolved: {
    id: "screen/drawer-target-unresolved",
    summary: "A drawer action targets a registered screen of the same feature.",
    fix: "Point screen at a screen declared in the same feature.",
  },
  drawerTargetNotActionForm: {
    id: "screen/drawer-target-not-action-form",
    summary: "A drawer action targets an actionForm screen.",
    fix: "Point screen at an actionForm screen, or use kind: navigate for a full-page target.",
  },
  prefillParamUnknownField: {
    id: "screen/prefill-param-unknown-field",
    summary: "Prefill params only name fields the target form declares.",
    fix: "Name a field the target form declares, or remove the param.",
  },
  prefillParamSensitiveField: {
    id: "screen/prefill-param-sensitive-field",
    summary: "Prefill params never name sensitive or password fields of the target form.",
    fix: "Remove the param or prefill a non-sensitive field.",
  },
  prefillParamNotRendered: {
    id: "screen/prefill-param-not-rendered",
    summary: "Prefill params only name fields the target form renders in its layout.",
    fix: "Add the field to the target layout or remove the param.",
  },
  navigateTabTargetUnresolved: {
    id: "screen/navigate-tab-target-unresolved",
    summary: "A navigate action with tab has a navigate-target that resolves to a screen.",
    fix: "Point the navigate-target at a registered screen.",
  },
  navigateTabTargetNotTabbed: {
    id: "screen/navigate-tab-target-not-tabbed",
    summary: "A navigate tab targets a projectionDetail screen with layout.mode tabs.",
    fix: "Remove the tab or navigate to a projectionDetail screen with layout.mode tabs.",
  },
  navigateTabUnknownSection: {
    id: "screen/navigate-tab-unknown-section",
    summary: "A navigate tab names a section id of the target screen.",
    fix: "Use one of the target screen's section ids.",
  },
  navigateTargetScreenAndEntity: {
    id: "screen/navigate-target-screen-and-entity",
    summary: "A navigate action sets either screen or entity, not both.",
    fix: "Remove one of screen and entity.",
  },
  navigateEntityTargetNeedsEntityId: {
    id: "screen/navigate-entity-target-needs-entity-id",
    summary: "An entity navigate-target on a non-entityList screen sets an explicit entityId.",
    fix: "Set entityId on the navigate action.",
  },
  navigateEntityTargetNoDetail: {
    id: "screen/navigate-entity-target-no-detail",
    summary: "An entity navigate-target has a screen declaring detailFor for that entity.",
    fix: "Add detailFor to a screen of the entity or navigate to a screen directly.",
  },
  navigateTargetNeitherScreenNorEntity: {
    id: "screen/navigate-target-neither-screen-nor-entity",
    summary: "A navigate action sets exactly one of screen and entity.",
    fix: "Set screen or entity on the navigate action.",
  },
  navigateTargetUnresolved: {
    id: "screen/navigate-target-unresolved",
    summary: "A navigate screen target resolves to a registered screen in any feature.",
    fix: 'Use "<feature>:screen:<id>" of an existing screen.',
  },
  redirectIdFromEmpty: {
    id: "screen/redirect-id-from-empty",
    summary: "A redirect object's idFrom is a non-empty string.",
    fix: "Name the success-payload field carrying the navigation id, or use the plain string redirect.",
  },
  redirectIdFromWhitespace: {
    id: "screen/redirect-id-from-whitespace",
    summary: "A redirect idFrom has no leading or trailing whitespace.",
    fix: "Remove the whitespace from idFrom.",
  },
  redirectIdFromOnIdlessTarget: {
    id: "screen/redirect-id-from-on-idless-target",
    summary: "A redirect idFrom only targets entityEdit or projectionDetail screens.",
    fix: "Use the plain string redirect form.",
  },
  successLinkTargetsRecordScreen: {
    id: "screen/success-link-targets-record-screen",
    summary: "A success link without idFrom does not target a record screen.",
    fix: "Set idFrom to the success-payload field carrying the record id.",
  },
  clientActionName: {
    id: "screen/client-action-name",
    summary: "A clientAction names its handler as <feature>:<kebab-name>.",
    fix: 'Use a name like "auth-email-password:request-password-reset".',
  },
  redirectOnListRowAction: {
    id: "screen/redirect-on-list-row-action",
    summary: "List and related-list row actions do not set redirect.",
    fix: "Remove redirect; it is only honored on record actions.",
  },
  primaryActionUnknown: {
    id: "screen/primary-action-unknown",
    summary: "primaryAction and inlineActions name a declared action id or the default edit.",
    fix: 'Use a declared action id, or "edit" when the screen sets detailFor.',
  },
  fallbackWithoutVisibleWhen: {
    id: "screen/fallback-without-visible-when",
    summary: "A screen with a fallback also declares visibleWhen.",
    fix: "Add visibleWhen or remove fallback.",
  },
  visibleWhenEmpty: {
    id: "screen/visible-when-empty",
    summary: "visibleWhen has a non-empty query and field.",
    fix: "Set both visibleWhen.query and visibleWhen.field.",
  },
  fallbackMapEmpty: {
    id: "screen/fallback-map-empty",
    summary: "A fallback map names at least one reason.",
    fix: "Set at least one fallback reason or use a screen id string.",
  },
  fallbackUnknownReason: {
    id: "screen/fallback-unknown-reason",
    summary: "Fallback map keys are known fallback reasons.",
    fix: "Use only the documented fallback reasons.",
  },
  fallbackSelf: {
    id: "screen/fallback-self",
    summary: "A screen's fallback points at a different screen.",
    fix: "Point fallback at a different screen.",
  },
  fallbackHasVisibleWhen: {
    id: "screen/fallback-has-visible-when",
    summary: "A fallback target has no visibleWhen of its own.",
    fix: "Point fallback at a screen without visibleWhen.",
  },
  writeHandlerUnregistered: {
    id: "screen/write-handler-unregistered",
    summary: "A handler reference resolves to a registered write handler.",
    fix: 'Check the QN spelling ("<feature>:write:<short>") and that r.writeHandler(...) declares it.',
  },
  actionFormSuccessItemsRedirect: {
    id: "screen/action-form-success-items-redirect",
    summary: "An actionForm shows successItems or redirects after submit, not both.",
    fix: "Drop redirect to show the successItems on the screen, or drop successItems to leave it.",
  },
} as const satisfies BootRuleTable;
