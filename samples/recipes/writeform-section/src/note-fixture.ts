// Server-free on purpose: the e2e mock dispatcher (browser bundle) imports
// this, so it must not pull in the feature's server-side code.
export const NOTE_DETAIL_FIELDS = {
  title: "Sample note",
  category: "question",
  priority: 2,
  body: "...",
};
