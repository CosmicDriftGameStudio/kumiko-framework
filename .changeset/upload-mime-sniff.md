---
"@cosmicdrift/kumiko-framework": patch
---

`GET /files/:id` served the stored `mimeType` as `Content-Type` without verifying it against the file's actual bytes — a client can declare any MIME at upload time, so an attacker could upload real HTML/SVG content and have it served back with a trusted-looking `Content-Type` from the app origin, enabling stored XSS. Uploads themselves are still accepted regardless of declared MIME (this is unchanged); the fix hardens serving instead.

The download route now sniffs the file's magic bytes and only serves the sniffed `Content-Type` inline when it matches a known-safe binary signature (png/jpeg/gif/webp/pdf) AND matches the declared MIME from upload. Anything else — including a genuine mismatch, or file types with no reliable binary signature such as `svg`/`txt`/`csv`/`json`/`md` — is now served as `application/octet-stream`. This also adds `X-Content-Type-Options: nosniff` to `GET /files/:id`, which previously had none (the `/files/:id/variant/:name` route already had it and is unchanged).

Breaking for consumers that render uploaded `svg`/`txt`/`csv`/`json`/`md` files inline (e.g. an `<img src>` pointing at `GET /files/:id`): those now download as `application/octet-stream` instead of rendering. Route such content through a purpose-built safe viewer if inline rendering is required.
