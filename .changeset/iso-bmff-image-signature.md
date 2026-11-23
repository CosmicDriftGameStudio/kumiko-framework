---
"@cosmicdrift/kumiko-framework": patch
---

Uploads named .heic, .heif or .avif are checked against the brands in their file header.

<!-- kumiko-changes
feature: framework
type: fix
title: heic, heif and avif uploads are verified against their file header
detail: A file named .heic, .heif or .avif, or declared as image/heic, image/heif or image/avif, has to list a matching still-image brand in its ftyp box (avif or avis, heic, heix, heim or heis, mif1), as major or compatible brand within the first 64 bytes. Other content under these names is refused with content_mismatch, or stored under its real type when the field accepts that type, the same as for png and pdf. mp4, mov and m4a share the container and are not taken for images, and a file that lists only a sequence brand (hevc, hevx, msf1) is refused. Stored files whose bytes and stored type agree are served as image/heic, image/heif or image/avif instead of application/octet-stream. A file stored earlier under one of these extensions with a different stored type no longer fits a field whose accept lists that extension.
-->
