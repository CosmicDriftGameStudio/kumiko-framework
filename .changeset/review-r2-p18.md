---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-bundled-features": patch
"@cosmicdrift/kumiko-types": patch
"@cosmicdrift/kumiko-renderer": patch
---

Review fixes: the upgrade check lists the codemod an improvement runs on apply, the package-merge codemod no longer leaves a target in both dependencies and devDependencies, the notification template meta type carries senderName and replyTo, and comments are corrected or rewrapped.

<!-- kumiko-changes
feature: framework
type: fix
title: Upgrade check names the codemod an improvement runs on apply
detail: kumiko-upgrade without --apply now prints the codemod of each improvement entry, the same way it prints the migration of breaking entries.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Package-merge codemod keeps one entry per target package
detail: When the merge target is already listed in dependencies, the old devDependencies entry is dropped; when the old entry is in dependencies and the target only in devDependencies, the target moves to dependencies so the runtime entry wins.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: NotificationTemplateMeta declares senderName and replyTo
detail: The type now matches the mail template meta schema of the template resolver, which accepts senderName and replyTo.
-->
