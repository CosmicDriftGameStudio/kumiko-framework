// Keeps document.documentElement.lang in sync with the active locale.
// Screen readers and the browser's built-in translate offer both read it,
// and @cosmicdrift/kumiko-dispatcher-live reads it back to tag outgoing
// requests with X-Locale (see dispatcher-live/src/locale.ts). This is the
// only way the dispatcher — a separate, server-dep-free package with no
// access to the resolver — learns the active language.
//
// Lives here, not in @cosmicdrift/kumiko-renderer: that package is DOM-free
// by design (Renderer-Boundaries Guard enforces it — web/native both
// consume it). createApp/createPublicSurface are the two places every web
// app already goes through, so mounting this here covers every app with
// zero app-side wiring, same as createBrowserLocaleResolver.

import type { LocaleResolver } from "@cosmicdrift/kumiko-headless";
import { useEffect } from "react";

export function DocumentLangSync({ resolver }: { readonly resolver: LocaleResolver }): null {
  useEffect(() => {
    document.documentElement.lang = resolver.locale();
    return resolver.subscribe(() => {
      document.documentElement.lang = resolver.locale();
    });
  }, [resolver]);
  return null;
}
