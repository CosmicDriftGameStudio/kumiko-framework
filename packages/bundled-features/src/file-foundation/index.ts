// Public API of the file-foundation bundled-feature.
//
// **What downstream apps import:**
//   - `fileFoundationFeature` — register at app boot
//   - `createFileProviderForTenant(ctx, tenantId)` — async factory for
//     a per-tenant `FileStorageProvider`
//   - `S3_SECRET_ACCESS_KEY` — typed secret-handle for direct secret-context use

export {
  createFileProviderForTenant,
  fileFoundationFeature,
  S3_SECRET_ACCESS_KEY,
} from "./feature";
