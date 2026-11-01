import type { BootRuleTable } from "./boot-rule.ts";

export const HANDLER_DECLARATION_RULES = {
  openToAllReasonInvalid: {
    id: "handler/open-to-all-reason-invalid",
    summary:
      "An openToAll declaration is an object with a valid reason explaining why any authenticated user may call the handler.",
    fix: 'Declare { openToAll: { reason: "<explanation>" } }.',
  },
  escapeHatchGrantsInvalid: {
    id: "handler/escape-hatch-grants-invalid",
    summary: "An escapeHatch declares valid grants.",
    fix: "Correct the escapeHatch grants as named in the error message.",
  },
  escapeHatchReasonInvalid: {
    id: "handler/escape-hatch-reason-invalid",
    summary: "An escapeHatch carries a valid reason.",
    fix: "Write an escapeHatch reason that explains the bypass.",
  },
  personalDataUnsupportedForKind: {
    id: "handler/personal-data-unsupported-for-kind",
    summary:
      "A personalData declaration appears only on handler kinds whose input is checked for personal-data fields.",
    fix: "Remove the personalData declaration from this handler.",
  },
  openToAllPersonalDataUnknown: {
    id: "handler/open-to-all-personal-data-unknown",
    summary: 'openToAll.personalData is "tenant-members" when set.',
    fix: 'Use personalData: "tenant-members" or remove it.',
  },
  accessPersonalDataUnknown: {
    id: "handler/access-personal-data-unknown",
    summary: 'access.personalData is "public-intake" when set.',
    fix: 'Use personalData: "public-intake" or remove it.',
  },
  publicIntakeWithoutAnonymous: {
    id: "handler/public-intake-without-anonymous",
    summary: 'A handler with access.personalData "public-intake" allows the anonymous role.',
    fix: "Add the anonymous role to access.roles or remove personalData.",
  },
  anySignedInInvalid: {
    id: "handler/any-signed-in-invalid",
    summary:
      "access.anySignedIn is true when set and appears only next to the anonymous role, on endpoints that are public anyway.",
    fix: 'Add "anonymous" to access.roles, or use { openToAll: { reason } } for every signed-in user without anonymous callers.',
  },
  publicIntakeRateLimitDisabled: {
    id: "handler/public-intake-rate-limit-disabled",
    summary:
      'A handler with access.personalData "public-intake" keeps its rateLimit enabled, because it is the only protection for anonymous personal-data writes.',
    fix: 'Declare rateLimit: { per: "ip" or "ip+handler", ... } instead of disabling it.',
  },
  inputSchemaNotIntrospectable: {
    id: "handler/input-schema-not-introspectable",
    summary: "A write handler's input schema is a Zod shape whose keys boot can collect.",
    fix: "Use an object schema the boot validator can walk, as named in the error message.",
  },
  openToAllPersonalDataUnbound: {
    id: "handler/open-to-all-personal-data-unbound",
    summary:
      "An openToAll write handler accepts personal-data fields only when they are bound to the caller or explicitly declared tenant-members.",
    fix: 'Bind rows to the caller, restrict access to roles, or declare openToAll: { reason, personalData: "tenant-members" }.',
  },
  anonymousPersonalDataUndeclared: {
    id: "handler/anonymous-personal-data-undeclared",
    summary:
      'A write handler that allows anonymous callers and accepts personal-data fields declares access.personalData "public-intake".',
    fix: 'Declare access: { roles: [..., "anonymous"], personalData: "public-intake" }.',
  },
  perCommandWithPhase: {
    id: "handler/per-command-with-phase",
    summary:
      'A write handler with transaction "perCommand" declares neither beforeTransaction nor reserveBeforeTransaction.',
    fix: "Move the phase into the commands the handler issues via ctx.dispatch.write.",
  },
  nestedSkipWithoutPhase: {
    id: "handler/nested-skip-without-before-transaction",
    summary: "A write handler with beforeTransactionWhenNested also declares beforeTransaction.",
    fix: "Declare beforeTransaction or remove beforeTransactionWhenNested.",
  },
  nestedSkipWithReservation: {
    id: "handler/nested-skip-with-reserve-before-transaction",
    summary:
      "A write handler with beforeTransactionWhenNested does not declare reserveBeforeTransaction, because a nested run would run unreserved.",
    fix: "Remove reserveBeforeTransaction or beforeTransactionWhenNested.",
  },
} as const satisfies BootRuleTable;
