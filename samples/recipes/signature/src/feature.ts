import { createSignatureFeature } from "@cosmicdrift/kumiko-bundled-features/signature";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

export const leaseEntity = createEntity({
  table: "recipe_signature_leases",
  fields: {
    name: createTextField({
      required: true,
      maxLength: 100,
      personal: false,
      reason: "technical_reference",
    }),
  },
});

// In an app the host is the record the document belongs to; a user sees its requests while they can read it.
export const leaseFeature = defineFeature("signature-recipe-lease", (r) => {
  r.entity({ name: "lease", ...leaseEntity });
});

// In an app `deliverLink` sends a mail to the signer. The recipe keeps the links in a map so the
// test can open them: the link is never part of a handler result.
export const deliveredLinks = new Map<string, string>();

export const SIGNATURE_LINK_SECRET = "signature-recipe-link-secret-0123456789";

export const signatureFeature = createSignatureFeature({
  retention: { keepFor: "10y", unfinishedKeepFor: "90d" },
  linkSecret: SIGNATURE_LINK_SECRET,
  hostEntities: ["lease"],
  signaturePageUrl: "https://app.example/sign",
  deliverLink: async (_ctx, { signerId, url }) => {
    deliveredLinks.set(signerId, url);
  },
});
