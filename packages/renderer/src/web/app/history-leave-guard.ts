import { hasUnsavedInput, requestLeave } from "../../index.ts";

// Back/Forward cannot be vetoed, so the browser has already moved by the time the guard asks.
// Each entry we create carries its position in history.state; with it a declined move is
// undone with history.go(-delta) and a confirmed one replayed with history.go(delta), so the
// stack keeps its shape (no duplicated or truncated entries).
const INDEX_KEY = "kumikoNavIndex";

type Committed = { url: string; index: number };
type ProgrammaticMove = "undo" | "replay";

const committed: Committed = { url: "", index: 0 };
let leaveRequestOpen = false;
// Each history.go() we issue produces one popstate that must not be treated as user navigation.
const pendingMoves: ProgrammaticMove[] = [];
// Entries without a position (written by other code) cannot be undone relatively.
let fallbackTargetUrl: string | undefined;

function readUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function stateAt(index: number): Record<string, number> {
  return { [INDEX_KEY]: index };
}

function readIndex(): number | undefined {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null) return undefined;
  const value = (state as Record<string, unknown>)[INDEX_KEY];
  return typeof value === "number" ? value : undefined;
}

export function committedUrl(): string {
  return committed.url;
}

/** Adopts the entry the browser currently shows as the committed one. */
export function adoptCurrentEntry(): void {
  const index = readIndex();
  committed.url = readUrl();
  if (index === undefined) {
    window.history.replaceState(stateAt(committed.index), "", committed.url);
  } else {
    committed.index = index;
  }
}

function commitCurrentUrl(): void {
  committed.url = readUrl();
  committed.index = readIndex() ?? committed.index;
}

export function pushEntry(url: string): void {
  window.history.pushState(stateAt(committed.index + 1), "", url);
  committed.index += 1;
  committed.url = readUrl();
}

export function replaceEntry(url: string): void {
  window.history.replaceState(stateAt(committed.index), "", url);
  commitCurrentUrl();
}

export function handlePopstate(notify: () => void): void {
  const move = pendingMoves.shift();
  if (move !== undefined) {
    if (move === "replay") {
      commitCurrentUrl();
      notify();
    }
    return;
  }
  if (fallbackTargetUrl !== undefined) {
    const target = fallbackTargetUrl;
    fallbackTargetUrl = undefined;
    // After a forward move the entry below our restore-push is not the target.
    if (readUrl() !== target) window.history.replaceState(stateAt(committed.index), "", target);
    commitCurrentUrl();
    notify();
    return;
  }
  const newIndex = readIndex();
  const delta = newIndex === undefined ? 0 : newIndex - committed.index;
  if (leaveRequestOpen) {
    // Another Back/Forward while the dialog is open must neither stack an entry nor replace the
    // open request: step back to the entry the dialog is about.
    if (delta !== 0) {
      pendingMoves.push("undo");
      window.history.go(-delta);
    } else {
      window.history.replaceState(stateAt(committed.index), "", committed.url);
    }
    return;
  }
  if (!hasUnsavedInput()) {
    commitCurrentUrl();
    notify();
    return;
  }
  const targetUrl = readUrl();
  leaveRequestOpen = true;
  const settle = (): void => {
    leaveRequestOpen = false;
  };
  if (delta !== 0) {
    pendingMoves.push("undo");
    window.history.go(-delta);
    requestLeave(() => {
      settle();
      pendingMoves.push("replay");
      window.history.go(delta);
    }, settle);
    return;
  }
  window.history.pushState(stateAt(committed.index), "", committed.url);
  requestLeave(() => {
    settle();
    fallbackTargetUrl = targetUrl;
    window.history.back();
  }, settle);
}
