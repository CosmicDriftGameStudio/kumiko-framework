import type { BootRuleTable } from "@cosmicdrift/kumiko-framework/engine";

export const HOST_ROUTING_BOOT_RULES = {
  invalidRedirect: {
    id: "host-routing/invalid-redirect",
    summary:
      "Redirect rules use a path as from, a same-origin path or https URL as to, and a lowercase hostname as host.",
    fix: "Fix the redirect rule named in the error message.",
  },
  invalidApexAnonymousQueryAllowlist: {
    id: "host-routing/invalid-apex-anonymous-query-allowlist",
    summary:
      "apexAnonymousQueryAllowlist keys are apex hostnames and the option is not combined with tenantBy path.",
    fix: "Use apex or www.<apex> keys and drop the option in path mode.",
  },
  invalidDomainOrPrefix: {
    id: "host-routing/invalid-domain-or-prefix",
    summary:
      "baseDomain and hosts keys are lowercase hostnames and tenantPathPrefix is a leading-slash path.",
    fix: "Fix the domain or prefix named in the error message.",
  },
  invalidLocales: {
    id: "host-routing/invalid-locales",
    summary: "Locales look like de or de-at and the default locale is not in prefixed.",
    fix: "Fix the locales option named in the error message.",
  },
} as const satisfies BootRuleTable;
