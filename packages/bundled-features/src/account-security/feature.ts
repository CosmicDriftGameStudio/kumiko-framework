import {
  type AccessRule,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AuthMfaQueries,
  MFA_DISABLE_SCREEN_ID,
  MFA_ENABLE_SCREEN_ID,
  MFA_REGENERATE_RECOVERY_SCREEN_ID,
} from "../auth-mfa/index.ts";
import { SESSION_MINE_SCREEN_ID } from "../sessions/index.ts";
import {
  ACCOUNT_SECURITY_FEATURE,
  ACCOUNT_SECURITY_NAV_LABEL,
  ACCOUNT_SECURITY_SCREEN_ID,
  ACCOUNT_SECURITY_SCREEN_QN,
} from "./web/constants.ts";
import { ACCOUNT_SECURITY_I18N } from "./web/i18n.ts";

export interface AccountSecurityNavOptions {
  readonly order?: number;
  readonly parent?: string;
}

export interface AccountSecurityFeatureOptions {
  // Who may open the dashboard. The embedded auth-mfa and sessions screens keep
  // their own handler access, so narrowing here only hides the entry point.
  readonly access?: AccessRule;
  // Without a nav entry the screen stays dormant: apps reach it from a user
  // menu or profile link instead of the sidebar.
  readonly nav?: AccountSecurityNavOptions;
}

const DEFAULT_ACCESS: AccessRule = {
  openToAll: { reason: "signed-in users manage their own account security" },
};

const DEFAULT_NAV_ORDER = 90;

export const accountSecurityMfaStatusVisibility = {
  query: AuthMfaQueries.status,
  field: "enabled",
} as const;

export function createAccountSecurityFeature(
  options: AccountSecurityFeatureOptions = {},
): FeatureDefinition {
  const { access = DEFAULT_ACCESS, nav } = options;
  return defineFeature(ACCOUNT_SECURITY_FEATURE, (r) => {
    r.describe(
      "Self-service account dashboard: MFA enrollment, recovery codes and the user's own sessions, composed from the auth-mfa and sessions screens.",
    );
    r.requires({ features: ["sessions"] });
    r.requires({ features: ["auth-mfa"] });
    r.translations({ keys: ACCOUNT_SECURITY_I18N });

    r.screen({
      id: ACCOUNT_SECURITY_SCREEN_ID,
      type: "dashboard",
      access,
      dormant: nav === undefined,
      panels: [
        {
          kind: "screen",
          id: "mfa-enable",
          screen: `auth-mfa:screen:${MFA_ENABLE_SCREEN_ID}`,
          visibleWhen: { ...accountSecurityMfaStatusVisibility, eq: false },
        },
        {
          kind: "screen",
          id: "mfa-regenerate",
          screen: `auth-mfa:screen:${MFA_REGENERATE_RECOVERY_SCREEN_ID}`,
          visibleWhen: { ...accountSecurityMfaStatusVisibility, eq: true },
        },
        {
          kind: "screen",
          id: "mfa-disable",
          screen: `auth-mfa:screen:${MFA_DISABLE_SCREEN_ID}`,
          visibleWhen: { ...accountSecurityMfaStatusVisibility, eq: true },
        },
        { kind: "screen", id: "sessions", screen: `sessions:screen:${SESSION_MINE_SCREEN_ID}` },
      ],
    });

    if (nav !== undefined) {
      // Explicit property assignments: the feature-AST parser reads neither
      // `??`, shorthand properties nor a conditional spread, and the boot validator treats
      // `parent: undefined` as a top-level entry.
      const { order: navOrder = DEFAULT_NAV_ORDER, parent: navParent } = nav;
      r.nav({
        id: ACCOUNT_SECURITY_SCREEN_ID,
        label: ACCOUNT_SECURITY_NAV_LABEL,
        screen: ACCOUNT_SECURITY_SCREEN_QN,
        order: navOrder,
        parent: navParent,
      });
    }
  });
}
