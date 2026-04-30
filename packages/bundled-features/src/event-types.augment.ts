// Augmentation der globalen KumikoEventTypeMap mit allen Event-Types der
// bundled-features. Use-site-Substitution macht diese Augmentation in jedem
// File sichtbar, das im selben tsc-Pass kompiliert wird (über
// `keyof TMap` mit `TMap = KumikoEventTypeMap` Default in HandlerContext).
//
// Diese Datei wird später vom Codegen (yarn kumiko codegen) automatisch
// generiert — bis dahin manuell gepflegt. Eintrag = ein r.defineEvent-Aufruf
// mit der Payload-Form aus dem zugehörigen Zod-Schema (siehe
// `<feature>/events.ts`).
//
// Re-export von `{}` macht das File zu einem Modul (statt Ambient-Script),
// damit `declare module` als Augmentation interpretiert wird.

import type { z } from "zod";
import type { deliveryAttemptSchema } from "./delivery/events";
import type { featureToggleSetSchema } from "./feature-toggles/events";
import type {
  runCompletedSchema,
  runFailedSchema,
  runStartedSchema,
} from "./jobs/events";
import type { secretReadSchema } from "./secrets/secrets-context";

declare module "@kumiko/framework/engine" {
  interface KumikoEventTypeMap {
    "feature-toggles:event:toggle-set": z.infer<typeof featureToggleSetSchema>;
    "delivery:event:attempt": z.infer<typeof deliveryAttemptSchema>;
    "jobs:event:run-started": z.infer<typeof runStartedSchema>;
    "jobs:event:run-completed": z.infer<typeof runCompletedSchema>;
    "jobs:event:run-failed": z.infer<typeof runFailedSchema>;
    "secrets:event:read": z.infer<typeof secretReadSchema>;
  }
}

export {};
