export type DeliveryFeatureOptions = {
  // Access gate for the delivery-log screen and the `log` query it reads —
  // both move together so the nav entry a role sees always matches a
  // callable handler. Default access.admin includes TenantAdmin,
  // who in a line-of-business app is the operator, not the platform — pass
  // access.systemAdmin to keep this platform-only and out of their nav.
  readonly access?: readonly string[];
  // Attempt events and log rows older than this many days are pruned by a daily job. Default 90;
  // `false` keeps the log forever.
  readonly attemptLogRetentionDays?: number | false;
};
