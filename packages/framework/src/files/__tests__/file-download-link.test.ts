import { describe, expect, test } from "bun:test";
import {
  createFileDownloadLinks,
  createFileDownloadLinkSigner,
  DEFAULT_FILE_DOWNLOAD_LINK_EXPIRY_SECONDS,
  FILE_DOWNLOAD_LINK_ROUTE_PREFIX,
} from "../file-download-link.ts";

const MASTER_SECRET = "download-link-master-secret-at-least-32-chars";
const TENANT = "00000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "00000000-0000-4000-8000-000000000002";
const FILE_REF = "11111111-1111-4111-8111-111111111111";
const OTHER_FILE_REF = "22222222-2222-4222-8222-222222222222";
const NOW = Temporal.Instant.from("2026-11-17T10:00:00Z");
const EXPIRES_AT_MS = NOW.add({ minutes: 10 }).epochMilliseconds;

const signer = createFileDownloadLinkSigner(MASTER_SECRET);
const claims = { tenantId: TENANT, fileRefId: FILE_REF, expiresAtMs: EXPIRES_AT_MS };

function replacePart(token: string, index: number, value: string): string {
  const parts = token.split(".");
  parts[index] = value;
  return parts.join(".");
}

describe("file download link signer", () => {
  test("a signed token verifies back to its claims", () => {
    expect(signer.verify(signer.sign(claims), NOW)).toEqual(claims);
  });

  test("a token is rejected once it has expired", () => {
    const token = signer.sign(claims);
    expect(signer.verify(token, Temporal.Instant.fromEpochMilliseconds(EXPIRES_AT_MS))).toBe(
      undefined,
    );
    expect(signer.verify(token, NOW.add({ hours: 1 }))).toBe(undefined);
  });

  test("a changed MAC character is rejected", () => {
    const token = signer.sign(claims);
    const last = token.at(-1);
    const tampered = token.slice(0, -1) + (last === "A" ? "B" : "A");
    expect(signer.verify(tampered, NOW)).toBe(undefined);
  });

  test("a swapped file or tenant part with the old MAC is rejected", () => {
    const token = signer.sign(claims);
    expect(signer.verify(replacePart(token, 1, OTHER_FILE_REF), NOW)).toBe(undefined);
    expect(signer.verify(replacePart(token, 0, OTHER_TENANT), NOW)).toBe(undefined);
  });

  test("a token signed with another master secret is rejected", () => {
    const foreign = createFileDownloadLinkSigner("another-master-secret-at-least-32-chars!");
    expect(signer.verify(foreign.sign(claims), NOW)).toBe(undefined);
  });

  test("malformed tokens are rejected", () => {
    const token = signer.sign(claims);
    expect(signer.verify(token.split(".").slice(0, 3).join("."), NOW)).toBe(undefined);
    expect(signer.verify(`${token}.extra`, NOW)).toBe(undefined);
    expect(signer.verify(replacePart(token, 2, "soon"), NOW)).toBe(undefined);
    expect(signer.verify("", NOW)).toBe(undefined);
  });
});

describe("file download links issued per tenant", () => {
  const links = createFileDownloadLinks({ signer, tenantId: TENANT, now: () => NOW });

  test("the default link lives 15 minutes and verifies to the issued file", () => {
    const link = links.issue(FILE_REF);

    expect(link.path.startsWith(FILE_DOWNLOAD_LINK_ROUTE_PREFIX)).toBe(true);
    expect(link.expiresAt).toBe(
      NOW.add({ seconds: DEFAULT_FILE_DOWNLOAD_LINK_EXPIRY_SECONDS }).toString(),
    );
    const claimed = signer.verify(link.path.slice(FILE_DOWNLOAD_LINK_ROUTE_PREFIX.length), NOW);
    expect(claimed?.tenantId).toBe(TENANT);
    expect(claimed?.fileRefId).toBe(FILE_REF);
  });

  test("an explicit lifetime within the limit is honoured", () => {
    expect(links.issue(FILE_REF, { expiresInSeconds: 60 }).expiresAt).toBe(
      NOW.add({ seconds: 60 }).toString(),
    );
  });

  test.each([0, 3601, 1.5])("a lifetime of %p seconds is refused", (expiresInSeconds) => {
    expect(() => links.issue(FILE_REF, { expiresInSeconds })).toThrow();
  });

  test("a file id that is not a UUID is refused", () => {
    expect(() => links.issue("x")).toThrow();
  });
});
