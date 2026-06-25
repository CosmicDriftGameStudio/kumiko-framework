// kumiko-feature-version: 1
//
// mail-transport-inmemory — In-Memory-EmailTransport für die mail-
// foundation Plugin-API. Sammelt Mails in einem per-Tenant-Buffer
// statt sie über einen echten SMTP-Server zu senden. Designed für
// Demos, Sample-Apps und Tests die ohne Mailpit/Mailcrab/echten SMTP
// laufen sollen.
//
// **Was diese Feature liefert:**
//   1. Plugin-Registration via `r.useExtension("mailTransport",
//      "inmemory", { build })`. Tenants setzen
//      "mail-foundation:config:provider" auf "inmemory" und kriegen
//      die buffered-Variante.
//   2. **Pro-Tenant Inbox.** Jeder Tenant hat einen eigenen
//      Mail-Buffer (Map<tenantId, EmailMessage[]>). Demo-Apps können
//      die Inbox via `getInbox(tenantId)` lesen + UI rendern.
//
// **Pattern-Vorbild:** mirrors mail-transport-smtp.
//
// **NICHT für Production.** Buffer ist im Process-Memory, geht beim
// Restart verloren. Cap-Counter / Audit-Trail bleiben trotzdem korrekt
// — die hängen am event-store, nicht am Transport.

import type {
  EmailMessage,
  EmailTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createInMemoryTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import type {
  MailTransportContext,
  MailTransportPlugin,
} from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const FEATURE_NAME = "mail-transport-inmemory";

// =============================================================================
// Per-tenant in-memory buffer
// =============================================================================
//
// Module-level Map weil der Plugin-build-call pro Send einen neuen
// Transport-Wrapper baut, aber wir wollen dass alle Wrapper für
// denselben Tenant auf denselben Buffer zeigen. Map<tenantId,
// InMemoryTransport>.

const transportsByTenant = new Map<string, ReturnType<typeof createInMemoryTransport>>();

function getOrCreateTransportForTenant(tenantId: string) {
  let transport = transportsByTenant.get(tenantId);
  if (!transport) {
    transport = createInMemoryTransport();
    transportsByTenant.set(tenantId, transport);
  }
  return transport;
}

/**
 * Demo/Test-Helper: lies die "versendeten" Mails eines Tenants. Im
 * Sample-App rendert ein query-Handler darauf die Inbox-UI.
 */
export function getInbox(tenantId: string): readonly EmailMessage[] {
  return transportsByTenant.get(tenantId)?.sent ?? [];
}

/**
 * Demo/Test-Helper: clear einen Tenant-Buffer (z.B. zwischen Test-
 * Szenarien).
 */
export function clearInbox(tenantId: string): void {
  const t = transportsByTenant.get(tenantId);
  if (t) t.sent.length = 0;
}

// =============================================================================
// Feature-definition
// =============================================================================

export const mailTransportInMemoryFeature = defineFeature(FEATURE_NAME, (r) => {
  r.describe(
    'Registers an in-process `"inmemory"` provider for `mail-foundation` that buffers sent mails per tenant instead of contacting an SMTP server. Use `getInbox(tenantId)` and `clearInbox(tenantId)` in demo apps and tests; not for production (buffer is process-memory, lost on restart).',
  );
  // Kein r.requires("config") + kein r.requires("secrets") — der
  // In-Memory-Transport hat keine Config (nichts zu konfigurieren) und
  // kein Secret. Der einzige hard-require ist mail-foundation, das den
  // extension-point "mailTransport" definiert.
  r.requires("mail-foundation");

  const plugin: MailTransportPlugin = {
    build: async (_ctx: MailTransportContext, tenantId: string): Promise<EmailTransport> => {
      // Returnt den per-tenant Buffer. Identitätsstabil zwischen calls
      // damit die Demo-Inbox accumulated bleibt.
      return getOrCreateTransportForTenant(tenantId);
    }, // @wrapper-known semantic-alias
  };
  r.useExtension("mailTransport", "inmemory", plugin);
});
