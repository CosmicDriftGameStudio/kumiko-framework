// Public API of the mail-foundation bundled-feature.
//
// **What downstream apps import:**
//   - `mailFoundationFeature` — register at app boot
//   - `createTransportForTenant(ctx, tenantId)` — async factory: looks
//     up the registered transport-plugin, returns its EmailTransport
//   - `MailTransportPlugin` — type that provider-features implement
//     when registering via `r.useExtension("mailTransport", ...)`

export {
  createTransportForTenant,
  isMailTransportPlugin,
  type MailTransportContext,
  type MailTransportPlugin,
  mailFoundationFeature,
} from "./feature";
