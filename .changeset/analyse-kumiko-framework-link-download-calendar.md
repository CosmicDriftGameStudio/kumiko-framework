---
"@cosmicdrift/kumiko-renderer": patch
---

The Link primitive keeps a `data:text/calendar` href when it carries `download`.

<!-- kumiko-changes
feature: renderer
type: fix
title: Calendar downloads work through the Link primitive
detail: `DefaultLink` with `download` replaced every href except `blob:` and `data:image/` with "#", so an .ics download built as a `data:text/calendar` URL needed a raw anchor. A download link now also keeps `data:text/calendar,…` and `data:text/calendar;charset=utf-8,…`. Only that exact media type passes; `data:text/html`, look-alike subtypes such as `data:text/calendar-x` and `javascript:` stay blocked, and without `download` every `data:` href stays blocked as before.
-->
