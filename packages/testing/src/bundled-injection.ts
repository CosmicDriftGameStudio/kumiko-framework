import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";

// kumiko-testing does not import bundled-features or dev-server; the pieces of them it needs are
// passed in. kumiko-dev-server/testing binds these once, so apps import the ready-made functions.

// Structural match for bundled-features' EmailMessage.
export type InboxMessage = {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text?: string;
  readonly from?: string;
  readonly fromName?: string;
  readonly replyTo?: string;
  readonly headers?: Readonly<Record<string, string>>;
};

export type SeedBundledApi = {
  readonly hashPassword: (password: string) => Promise<string>;
  readonly UserHandlers: { readonly create: string; readonly update: string };
  readonly TenantHandlers: { readonly create: string; readonly addMember: string };
};

export type SeedRouteBundledApi = SeedBundledApi & {
  readonly tenantMeQuery: string;
  readonly mailInbox: {
    readonly featureName: string;
    readonly read: (tenantId: TenantId) => readonly InboxMessage[];
  };
};
