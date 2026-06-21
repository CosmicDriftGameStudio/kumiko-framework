import type { Dispatcher, DispatcherError } from "@cosmicdrift/kumiko-headless";

// Dispatch a query/handler whose result carries `{ url }` (a signed,
// short-lived storage URL with `content-disposition: attachment`), then
// navigate the browser to it so the file downloads. The query rides the
// live dispatcher, so it carries the `X-CSRF-Token` header automatically —
// unlike a plain `<a href>` navigation, which sends only cookies and trips
// the CSRF double-submit check on any server-side re-dispatch.
//
// Web-only (uses `window`). Returns the dispatcher error on failure (so the
// caller can surface its i18nKey), or null on success.
export async function postWithDownload(
  dispatcher: Dispatcher,
  type: string,
  payload: unknown,
): Promise<DispatcherError | null> {
  const res = await dispatcher.query<{ url?: string }>(type, payload);
  if (!res.isSuccess) return res.error;
  if (!res.data?.url) {
    return {
      code: "download_url_missing",
      httpStatus: 502,
      i18nKey: "errors.download.urlMissing",
      message: "download query returned no url",
    };
  }
  window.location.assign(res.data.url);
  return null;
}
