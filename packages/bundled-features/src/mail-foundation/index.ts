// Public API of the mail-foundation bundled-feature.
//
// **What downstream apps import:**
//   - `mailFoundationFeature` — register at app boot
//   - `createTransportForTenant(ctx, tenantId)` — async factory for
//     a per-tenant `EmailTransport`
//   - `SMTP_PASSWORD` — typed secret-handle for direct secret-context use

export {
  createTransportForTenant,
  mailFoundationFeature,
  SMTP_PASSWORD,
} from "./feature";
