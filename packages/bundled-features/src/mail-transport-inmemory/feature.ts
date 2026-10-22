// kumiko-feature-version: 1
//
// mail-transport-inmemory — In-memory email transport for the mail-
// foundation plugin API. Collects emails in a per-tenant buffer
// instead of sending them through a real SMTP server. Designed for
// demos, sample apps, and tests that should run without Mailpit,
// Mailcrab, or real SMTP.
//
// **What this feature provides:**
//   1. Plugin registration via `r.useExtension("mailTransport",
//      "inmemory", { build })`. Tenants set
//      "mail-foundation:config:provider" to "inmemory" and receive
//      the buffered variant.
//   2. **Per-tenant inbox.** Each tenant has its own mail buffer
//      (Map<tenantId, EmailMessage[]>). Demo apps can read the inbox
//      via `getInbox(tenantId)` and render a UI.
//
// **Pattern reference:** mirrors mail-transport-smtp.
//
// **NOT for production.** The buffer is in process memory and is lost
// on restart. Cap counters and the audit trail remain correct because
// they are tied to the event store, not the transport.

import type {
  EmailMessage,
  EmailTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createInMemoryTransport } from "@cosmicdrift/kumiko-bundled-features/channel-email";
import {
  MAIL_TRANSPORT_EXTENSION,
  type MailTransportContext,
  type MailTransportPlugin,
} from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const FEATURE_NAME = "mail-transport-inmemory";

// =============================================================================
// Per-tenant in-memory buffer
// =============================================================================
//
// The module-level Map is needed because the plugin build call creates
// a new transport wrapper for each send, while all wrappers for the
// same tenant must point to the same buffer. Map<tenantId,
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
 * Demo/test helper: reads the emails "sent" for a tenant. A query
 * handler in the sample app uses this to render the inbox UI.
 */
export function getInbox(tenantId: string): readonly EmailMessage[] {
  return transportsByTenant.get(tenantId)?.sent ?? [];
}

/**
 * Demo/test helper: clears a tenant's buffer, for example between
 * test scenarios.
 */
export function clearInbox(tenantId: string): void {
  const t = transportsByTenant.get(tenantId);
  if (t) t.sent.length = 0;
}

// =============================================================================
// Feature-definition
// =============================================================================
export function createMailTransportInMemoryFeature() {
  return defineFeature(
    FEATURE_NAME,
    (r) => {
      r.describe(
        'Registers an in-process `"inmemory"` provider for `mail-foundation` that buffers sent mails per tenant instead of contacting an SMTP server. Use `getInbox(tenantId)` and `clearInbox(tenantId)` in demo apps and tests; not for production (buffer is process-memory, lost on restart).',
      );
      // No `config` or `secrets` requirement: the in-memory transport has
      // no configuration and no secret. The only hard requirement is
      // mail-foundation, which defines the "mailTransport" extension point.
      r.requires({ features: ["mail-foundation"] });

      const plugin: MailTransportPlugin = {
        // Solon and studio mount it next to smtp in production; offering it there would
        // let a tenant admin route every mail into process memory.
        selectableInSettings: false,
        build: async (_ctx: MailTransportContext, tenantId: string): Promise<EmailTransport> => {
          // Returns the per-tenant buffer. Identity-stable across calls so the
          // demo inbox keeps accumulating.
          return getOrCreateTransportForTenant(tenantId);
        }, // @wrapper-known semantic-alias
      };
      r.useExtension(MAIL_TRANSPORT_EXTENSION, "inmemory", plugin);
      r.translations({
        keys: { "mail-transport-inmemory.settings": { en: "Test inbox (in memory)" } },
      });
    },
    { dedupeOptions: {} },
  );
}
