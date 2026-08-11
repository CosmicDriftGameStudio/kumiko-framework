// Browser-backed DraftStorage default for createKumikoApp (issue #1913).
//
// Persists a create-mode draftId per screen in `sessionStorage` — same-tab
// scope only (deliberately, unlike browser-locale.ts's localStorage): the
// draft row itself already survives a new tab / cleared storage via
// RenderEdit's `form-draft:query:list` mount-time fallback, so this is only
// about not losing the draftId on an accidental same-tab reload.

import type { DraftStorage } from "@cosmicdrift/kumiko-renderer";

export type CreateBrowserDraftStorageOptions = {
  /** sessionStorage-key prefix, one entry per screenId gets appended.
   *  Default: `"kumiko:draft-id:"`. */
  readonly storagePrefix?: string;
};

function keyFor(prefix: string, screenId: string): string {
  return `${prefix}${screenId}`;
}

/** Default DraftStorage when createKumikoApp boots without one. Guards every
 *  sessionStorage call — Safari private mode and storage-disabled browsers
 *  throw on access, and a lost draftId just falls back to the `list` resume
 *  path (same UX as a genuinely cleared storage), not a broken form. */
export function createBrowserDraftStorage(
  options: CreateBrowserDraftStorageOptions = {},
): DraftStorage {
  const prefix = options.storagePrefix ?? "kumiko:draft-id:";
  return {
    getDraftId: (screenId) => {
      if (typeof sessionStorage === "undefined") return null;
      try {
        return sessionStorage.getItem(keyFor(prefix, screenId));
      } catch {
        return null;
      }
    },
    setDraftId: (screenId, draftId) => {
      // skip: no sessionStorage in this environment (SSR, disabled) — the
      // draftId just stays in-memory-only for this render.
      if (typeof sessionStorage === "undefined") return;
      try {
        sessionStorage.setItem(keyFor(prefix, screenId), draftId);
      } catch {
        // Persistence failure isn't fatal — the draft stays usable in the
        // current tab, only a reload would lose the draftId.
      }
    },
    clearDraftId: (screenId) => {
      // skip: no sessionStorage in this environment — nothing to clear.
      if (typeof sessionStorage === "undefined") return;
      try {
        sessionStorage.removeItem(keyFor(prefix, screenId));
      } catch {
        // skip: nothing to clean up if storage is unreachable.
      }
    },
  };
}
