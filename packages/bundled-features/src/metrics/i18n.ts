type LocalizedString = { readonly en: string };

export const METRICS_I18N: Readonly<Record<string, LocalizedString>> = {
  "metrics:jobStatus.queued": { en: "Queued" },
  "metrics:jobStatus.running": { en: "Running" },
  "metrics:jobStatus.completed": { en: "Completed" },
  "metrics:jobStatus.failed": { en: "Failed" },
  "metrics:deliveryStatus.queued": { en: "Queued" },
  "metrics:deliveryStatus.sent": { en: "Sent" },
  "metrics:deliveryStatus.failed": { en: "Failed" },
  "metrics:deliveryStatus.skipped": { en: "Skipped" },
  "metrics.errors.tenantFilterUnsupported": {
    en: "This metric's source has no tenant column, so it cannot be narrowed to one tenant.",
  },
};
