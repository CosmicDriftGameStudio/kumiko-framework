---
"@cosmicdrift/kumiko-renderer": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-it": patch
---

The "This page is not available" state now always offers a primary "Go to start page" button (the start page comes from the new `HomeScreenProvider`, mounted by `createKumikoApp`, so drawers and `KumikoScreen` get it too) and a second line telling the user whom to ask (new key `kumiko.screen-missing.contact`). The hint reads "Either it is not enabled for your account or it no longer exists."

<!-- kumiko-changes
feature: renderer
type: improvement
title: The "page not available" and "record not found" pages are a calm empty state with a way back
detail: New optional primitive `EmptyState` (`icon` "unavailable" or "not-found", `title`, `description`, `actions`) renders a centered page with an icon in a soft circle; custom primitive sets without it keep the plain card. "This page is not available" now always offers a primary "Go to start page" button (start page from the new `HomeScreenProvider`, mounted by `createKumikoApp`, so drawers and `KumikoScreen` get it too) and a line telling the user whom to ask (new i18n key `kumiko.screen-missing.contact`, en/de/fr/es/it). The "record not found" page uses the same look.
-->
