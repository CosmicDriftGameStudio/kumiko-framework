import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";

export type DeviceRow = {
  readonly id: string;
  readonly ownerTenantId: string;
  readonly connectorId: string;
  readonly tokenPrefix: string;
  readonly reportedVersion: string | null;
  readonly lastSeenAt: Temporal.Instant | null;
  readonly createdAt: Temporal.Instant;
  readonly revokedAt: Temporal.Instant | null;
};

export const isoOrNull = (instant: Temporal.Instant | null): string | null =>
  instant === null ? null : instant.toString();
