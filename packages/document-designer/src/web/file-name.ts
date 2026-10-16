// @runtime client
// The upload input only hands back the FileRef id; resources are keyed and named after the file.
export async function fetchStoredFileName(fileRefId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/files/${encodeURIComponent(fileRefId)}/meta`);
    if (!res.ok) return null;
    const meta: unknown = await res.json();
    if (typeof meta !== "object" || meta === null || !("fileName" in meta)) return null;
    return typeof meta.fileName === "string" ? meta.fileName : null;
  } catch {
    return null;
  }
}

export const fileUrl = (fileRefId: string): string => `/api/files/${encodeURIComponent(fileRefId)}`;
