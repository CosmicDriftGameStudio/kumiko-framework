---
"@cosmicdrift/kumiko-bundled-features": patch
---

nodemailer is raised to 10.2.1; the workspace overrides lift ip-address to 10.7.4 and fast-copy to 4.2.0 for open advisories.

<!-- kumiko-changes
feature: mail-transport-smtp
type: fix
title: nodemailer 10.2.1 fixes the address-parser advisories
detail: nodemailer 10.0.13 mis-parsed quoted semicolons, angle brackets and nested comments in addresses (GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h, GHSA-8c8m-p3m8-cjg8). The dependency is now 10.2.1, and the overrides for ip-address (10.7.4) and fast-copy (4.2.0) remove the remaining audit findings.
-->
