import { createLongTextField, createTextField } from "../factories.js";
import type { LongTextFieldDef, TextFieldDef } from "../types/index.js";

// Derived from the factories (minus the stance marker) so factory default changes flow in.
const { allowPlaintext: _textStance, ...unannotatedTextFields } = createTextField({
  personal: false,
  reason: "test_fixture",
});
const { allowPlaintext: _longTextStance, ...unannotatedLongTextFields } = createLongTextField({
  personal: false,
  reason: "test_fixture",
});

export const unannotatedText: TextFieldDef = unannotatedTextFields;
export const unannotatedLongText: LongTextFieldDef = unannotatedLongTextFields;
