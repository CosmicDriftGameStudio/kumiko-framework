import { createLongTextField, createTextField } from "../factories.ts";

// Filler for tests where the field's stance is irrelevant. Entity text fields must
// carry a stance, so the fixture states an explicit non-personal one.
export const plaintextText = createTextField({ personal: false, reason: "test_fixture" });
export const plaintextLongText = createLongTextField({ personal: false, reason: "test_fixture" });
