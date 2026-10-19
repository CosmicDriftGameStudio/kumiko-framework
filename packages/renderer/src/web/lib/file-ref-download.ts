import { CSRF_HEADER_NAME, readCsrfToken } from "../../live/index.ts";

const UTF8_BOM = String.fromCharCode(0xfeff);

export class FileDownloadFailedError extends Error {
  constructor(readonly status: number) {
    super(`download failed (${status})`);
  }
}

const EXTENDED_FILENAME = /filename\*\s*=\s*(?:[^']*)'[^']*'([^;]+)/i;
const PLAIN_FILENAME = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i;

export function fileNameFromContentDisposition(header: string | null): string | undefined {
  if (header === null) return undefined;
  const extended = EXTENDED_FILENAME.exec(header)?.[1];
  if (extended !== undefined) {
    try {
      return decodeURIComponent(extended.trim());
    } catch {
      // malformed percent-encoding: fall back to the plain filename
    }
  }
  const plain = PLAIN_FILENAME.exec(header);
  const value = plain?.[1]?.replace(/\\(.)/g, "$1") ?? plain?.[2]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export async function fetchFileRefBlob(
  fileRefId: string,
): Promise<{ blob: Blob; fileName: string | undefined }> {
  const csrf = readCsrfToken();
  const res = await fetch(`/api/files/${encodeURIComponent(fileRefId)}`, {
    ...(csrf !== undefined && { headers: { [CSRF_HEADER_NAME]: csrf } }),
  });
  if (!res.ok) throw new FileDownloadFailedError(res.status);
  return {
    blob: await res.blob(),
    fileName: fileNameFromContentDisposition(res.headers.get("content-disposition")),
  };
}

export function saveBlobAsFile(fileName: string, blob: Blob, options?: { bom?: boolean }): void {
  const payload = options?.bom === true ? new Blob([UTF8_BOM, blob], { type: blob.type }) : blob;
  const url = URL.createObjectURL(payload);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadFileRef(
  fileRefId: string,
  options?: { fileName?: string },
): Promise<void> {
  const { blob, fileName } = await fetchFileRefBlob(fileRefId);
  saveBlobAsFile(fileName ?? options?.fileName ?? fileRefId, blob);
}
