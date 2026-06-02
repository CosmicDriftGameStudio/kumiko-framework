import { describe, expect, test } from "bun:test";
import { fieldDefinitionAggregateId } from "../aggregate-id";

// Drift-Pin-Tests — diese Werte sind Cross-File-Contracts, ein Wechsel muss
// bewusst geschehen. Wenn diese Tests rot werden: stop, denk nach, revert.
// aggregate-id.ts verweist namentlich auf diese Datei.

describe("custom-fields drift pins", () => {
  test("fieldDefinition aggregate-id namespace is stable across boots", () => {
    // FIELD_DEFINITION_NAMESPACE is in stone — changing it re-keys every
    // existing fieldDefinition-stream and breaks event-replay +
    // definition-history. If this fails: revert the namespace, do not adjust
    // the expected values.
    const sys = fieldDefinitionAggregateId(
      "00000000-0000-0000-0000-000000000001",
      "customer",
      "internalNumber",
    );
    const sysAgain = fieldDefinitionAggregateId(
      "00000000-0000-0000-0000-000000000001",
      "customer",
      "internalNumber",
    );
    const otherTenant = fieldDefinitionAggregateId(
      "11111111-1111-1111-1111-111111111111",
      "customer",
      "internalNumber",
    );
    const otherKey = fieldDefinitionAggregateId(
      "00000000-0000-0000-0000-000000000001",
      "customer",
      "otherKey",
    );

    expect(sys).toBe(sysAgain); // deterministic: same triple → same id
    expect(sys).not.toBe(otherTenant); // tenantId is part of the key (scope isolation)
    expect(sys).not.toBe(otherKey); // fieldKey is part of the key
    // Pinned actual outputs — the drift-detector for the namespace constant.
    expect(sys).toBe("a6e22096-55ac-54c1-a759-aa42fa94dbe8");
    expect(otherTenant).toBe("5a6cbaf1-159e-53a1-aaed-0e3b836decbe");
    expect(otherKey).toBe("4b683fa3-9560-5747-bee9-46ea237393ac");
  });
});
