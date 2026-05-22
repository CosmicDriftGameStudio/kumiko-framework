// custom-fields — Tenant- + System-scoped Custom-Field-Definitions.
//
// **Was diese Feature liefert (B1, 2026-05-22):**
//   1. r.entity("field-definition") — Definition-Storage (event-sourced).
//   2. define-tenant-field / define-system-field — write-handlers (RBAC).
//   3. delete-tenant-field / delete-system-field — write-handlers (RBAC).
//   4. defineEntityListHandler — read alle Definitionen des current-tenants
//      (B1 limitation: nur tenant-scope; B2 wird system+tenant UNION
//      ergänzen).
//
// **Was B2 ergänzen wird:**
//   - customField.set / customField.cleared Event-Types
//   - MSP für value-projection in read_<entity>.customFields jsonb
//   - r.extendsRegistrar("customFields", ...) + onRegister-Wiring
//   - F1 postQuery / F3 search-payload-extension contributors
//   - Cross-scope-conflict-Detection (tenant darf system-fieldKey nicht
//     überschreiben)
//   - user-data-rights anonymization-Wiring für sensitive customFields
//   - cap-counter wiring im fieldDefinition-create-Handler
//
// **Out-of-Scope (Plan-Doc v2):**
//   - Tenant-Admin UI (Post-Todo, Phase β)
//   - In-place type-change auf existing fieldDefinition — caller must
//     DELETE + CREATE (Plan-Doc v2 B1.8 "Type-Change-Lock v1")

import { defineEntityListHandler, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { CUSTOM_FIELDS_FEATURE_NAME } from "./constants";
import { fieldDefinitionEntity } from "./entity";
import { defineSystemFieldHandler } from "./handlers/define-system-field.write";
import { defineTenantFieldHandler } from "./handlers/define-tenant-field.write";
import { deleteSystemFieldHandler } from "./handlers/delete-system-field.write";
import { deleteTenantFieldHandler } from "./handlers/delete-tenant-field.write";

const tenantAdminAccess = { access: { roles: ["TenantAdmin"] } } as const;

export function createCustomFieldsFeature() {
  return defineFeature(CUSTOM_FIELDS_FEATURE_NAME, (r) => {
    r.entity("field-definition", fieldDefinitionEntity);

    // Write-Handlers — tenant + system Scope getrennt durch dedicated Handlers
    // mit unterschiedlichen access-rules.
    r.writeHandler(defineTenantFieldHandler);
    r.writeHandler(defineSystemFieldHandler);
    r.writeHandler(deleteTenantFieldHandler);
    r.writeHandler(deleteSystemFieldHandler);

    // List-Query — tenant kann seine eigenen Definitionen sehen. B2 wird
    // einen Custom-Query mit UNION über (current-tenant ∪ SYSTEM_TENANT_ID)
    // ergänzen.
    r.queryHandler(
      defineEntityListHandler("field-definition", fieldDefinitionEntity, tenantAdminAccess),
    );
  });
}
