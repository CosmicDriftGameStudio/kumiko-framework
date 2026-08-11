import { createContext, type ReactNode, useContext } from "react";

// Client-side draftId storage for RenderEdit's create-mode draftKey (issue
// #1913) — `${screen.id}:new:${draftId}` needs the same `draftId` across a
// same-tab reload so the wizard resumes the right row instead of the leader
// on the last-write-wins upsert. Contract only, platform-neutral — the
// concrete impl (window.sessionStorage on web) is injected by the platform
// package, same pattern as NavApi/window.history in app/nav.tsx. This
// package touches no browser storage itself.
export type DraftStorage = {
  readonly getDraftId: (screenId: string) => string | null;
  readonly setDraftId: (screenId: string, draftId: string) => void;
  readonly clearDraftId: (screenId: string) => void;
};

// No-op default: without a mounted provider (unwired platform, or a test
// that doesn't care about drafts) same-tab reload just loses draftId
// persistence — RenderEdit falls back to its `form-draft:query:list`
// resume path, the same one a cleared sessionStorage takes on the web.
const noopDraftStorage: DraftStorage = {
  getDraftId: () => null,
  setDraftId: () => {},
  clearDraftId: () => {},
};

const DraftStorageContext = createContext<DraftStorage>(noopDraftStorage);

export type DraftStorageProviderProps = {
  readonly value: DraftStorage;
  readonly children: ReactNode;
};

export function DraftStorageProvider({ value, children }: DraftStorageProviderProps): ReactNode {
  return <DraftStorageContext value={value}>{children}</DraftStorageContext>;
}

export function useDraftStorage(): DraftStorage {
  return useContext(DraftStorageContext);
}
