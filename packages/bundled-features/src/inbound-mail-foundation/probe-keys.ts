export const INBOUND_PROBE_KEYS = {
  area: "inbound-mail-foundation.probe.area",
  label: "inbound-mail-foundation.probe.mailboxes.label",
  mailbox: "inbound-mail-foundation.probe.mailbox",
  reachable: "inbound-mail-foundation.probe.mailbox.reachable",
  authFailed: "inbound-mail-foundation.probe.mailbox.auth-failed",
  gone: "inbound-mail-foundation.probe.mailbox.gone",
} as const;

export const INBOUND_PROBE_I18N = {
  [INBOUND_PROBE_KEYS.area]: { en: "Inbound email" },
  [INBOUND_PROBE_KEYS.label]: { en: "Connected mailboxes" },
  [INBOUND_PROBE_KEYS.mailbox]: { en: "Mailbox {name}" },
  [INBOUND_PROBE_KEYS.reachable]: { en: "Mailbox reachable" },
  [INBOUND_PROBE_KEYS.authFailed]: { en: "The mailbox rejected the stored login" },
  [INBOUND_PROBE_KEYS.gone]: { en: "Mailbox no longer exists" },
} as const;
