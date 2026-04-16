// Domain-identifier type aliases. Used everywhere a tenantId/userId/aggregateId
// travels through the framework. One declaration per concept so future
// representation changes (branded types, UUID validation, opaque wrappers)
// land in a single place.

// Tenant identifier — UUID string today. May become branded/opaque later
// without touching call sites.
export type TenantId = string;
