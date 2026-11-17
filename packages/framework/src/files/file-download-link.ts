import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  FileDownloadLink,
  FileDownloadLinkClaims,
  FileDownloadLinks,
  FileDownloadLinkSigner,
} from "@cosmicdrift/kumiko-types/file-handle-types";
import { isUuid, parseTenantId, type TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { InternalError } from "../errors/classes.ts";
import { derivePurposeSecret } from "../secrets/derive-purpose-secret.ts";

export const FILE_DOWNLOAD_LINK_ROUTE_PREFIX = "/api/files/link/";

const FILE_DOWNLOAD_LINK_PURPOSE = "kumiko:file-download-link-v1";

export const DEFAULT_FILE_DOWNLOAD_LINK_EXPIRY_SECONDS = 15 * 60;
export const MAX_FILE_DOWNLOAD_LINK_EXPIRY_SECONDS = 60 * 60;

const EXPIRY_MS_PATTERN = /^\d{1,16}$/;

export function createFileDownloadLinkSigner(masterSecret: string): FileDownloadLinkSigner {
  const key = derivePurposeSecret(masterSecret, FILE_DOWNLOAD_LINK_PURPOSE);
  const macOf = (payload: string): string =>
    createHmac("sha256", key).update(payload).digest("base64url");

  return {
    sign({ tenantId, fileRefId, expiresAtMs }) {
      const payload = `${tenantId}.${fileRefId}.${expiresAtMs}`;
      return `${payload}.${macOf(payload)}`;
    },
    verify(token, now): FileDownloadLinkClaims | undefined {
      const parts = token.split(".");
      if (parts.length !== 4) return undefined;
      const [tenantPart, fileRefId, expiryPart, mac] = parts;
      if (
        tenantPart === undefined ||
        fileRefId === undefined ||
        expiryPart === undefined ||
        mac === undefined
      ) {
        return undefined;
      }
      const tenantId = parseTenantId(tenantPart);
      if (tenantId === null || !isUuid(fileRefId) || !EXPIRY_MS_PATTERN.test(expiryPart)) {
        return undefined;
      }
      const expiresAtMs = Number(expiryPart);
      if (expiresAtMs <= now.epochMilliseconds) return undefined;
      const expected = Buffer.from(macOf(`${tenantPart}.${fileRefId}.${expiryPart}`));
      const actual = Buffer.from(mac);
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        return undefined;
      }
      return { tenantId, fileRefId, expiresAtMs };
    },
  };
}

export function createFileDownloadLinks(args: {
  readonly signer: FileDownloadLinkSigner;
  readonly tenantId: TenantId;
  readonly now: () => Temporal.Instant;
}): FileDownloadLinks {
  const { signer, tenantId, now } = args;
  return {
    // The calling handler is the access check: it may only issue links for files it released to the caller.
    issue(fileRefId, opts): FileDownloadLink {
      if (!isUuid(fileRefId)) {
        throw new InternalError({ message: "fileDownloadLinks.issue: fileRefId must be a UUID" });
      }
      const expiresInSeconds = opts?.expiresInSeconds ?? DEFAULT_FILE_DOWNLOAD_LINK_EXPIRY_SECONDS;
      if (
        !Number.isInteger(expiresInSeconds) ||
        expiresInSeconds < 1 ||
        expiresInSeconds > MAX_FILE_DOWNLOAD_LINK_EXPIRY_SECONDS
      ) {
        throw new InternalError({
          message: `fileDownloadLinks.issue: expiresInSeconds must be an integer in 1..${MAX_FILE_DOWNLOAD_LINK_EXPIRY_SECONDS}`,
        });
      }
      const expiresAt = now().add({ seconds: expiresInSeconds });
      const token = signer.sign({ tenantId, fileRefId, expiresAtMs: expiresAt.epochMilliseconds });
      return { path: FILE_DOWNLOAD_LINK_ROUTE_PREFIX + token, expiresAt: expiresAt.toString() };
    },
  };
}
