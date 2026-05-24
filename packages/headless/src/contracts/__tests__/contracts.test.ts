import { describe, expect, mock, test } from "bun:test";
import type {
  AssetResolver,
  ButtonProps,
  LocaleResolver,
  PrimitiveCommonProps,
  PrimitivesContract,
  SelectProps,
  TextInputProps,
} from "../index";

// These aren't unit tests — they're compile-time contract guards in
// runtime clothing. Building a small fake that satisfies each contract
// ensures a future refactor that drops or renames a required field
// breaks here loudly instead of in some downstream renderer.

describe("Asset / Locale / Primitives contracts", () => {
  test("AssetResolver — a minimal in-memory resolver compiles and runs", () => {
    const table = new Map<string, { uri: string; alt?: string }>([
      ["app:asset:logo", { uri: "/static/logo.svg", alt: "Kumiko" }],
    ]);
    const resolver: AssetResolver = {
      resolve(qn) {
        const found = table.get(qn);
        return found ? { uri: found.uri, alt: found.alt } : null;
      },
    };

    expect(resolver.resolve("app:asset:logo")?.uri).toBe("/static/logo.svg");
    expect(resolver.resolve("app:asset:missing")).toBeNull();
  });

  test("LocaleResolver — subscribe/unsubscribe + translate with params", () => {
    const listeners = new Set<() => void>();
    const resolver: LocaleResolver = {
      translate(key, params) {
        // Minimal translation: "errors.value.minimum" + {min:3} → "≥3"
        if (key === "errors.value.minimum" && params?.["min"] !== undefined) {
          return `≥${params["min"]}`;
        }
        return key;
      },
      locale: () => "de-AT",
      timeZone: () => "Europe/Vienna",
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    expect(resolver.translate("errors.value.minimum", { min: 3 })).toBe("≥3");
    expect(resolver.locale()).toBe("de-AT");

    const listener = mock();
    const unsubscribe = resolver.subscribe(listener);
    for (const l of listeners) l();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    for (const l of listeners) l();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("PrimitivesContract — a fake renderer's primitives satisfy the type", () => {
    // The renderer-side wiring creates a concrete object where each
    // member is a component. From ui-core's vantage they're opaque
    // values typed as `unknown` — we only care that all 11 keys are
    // present.
    const primitives: PrimitivesContract = {
      TextInput: { kind: "text-input" },
      NumberInput: { kind: "number-input" },
      Select: { kind: "select" },
      Toggle: { kind: "toggle" },
      DatePicker: { kind: "date-picker" },
      Button: { kind: "button" },
      Modal: { kind: "modal" },
      Toast: { kind: "toast" },
      Badge: { kind: "badge" },
      Card: { kind: "card" },
      Icon: { kind: "icon" },
    };

    // Exhaustiveness — missing a key means the contract drifted without
    // updating this test (and, by implication, every primitives-* impl).
    expect(Object.keys(primitives)).toHaveLength(11);
  });

  test("PrimitiveCommonProps propagate to concrete props (TextInput, Select, Button)", () => {
    // Compile-time assertion: PrimitiveCommonProps members narrow correctly
    // on each derived prop type. Runtime side just checks the object
    // shape we'd hand to a primitive component.
    const textProps: TextInputProps = {
      id: "title",
      name: "title",
      disabled: false,
      readOnly: false,
      required: true,
      label: "Title",
      value: "hello",
      onChange: () => {},
      type: "text",
    };
    const selectProps: SelectProps<"a" | "b"> = {
      label: "Pick one",
      value: "a",
      onChange: () => {},
      options: [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ],
    };
    const buttonProps: ButtonProps = {
      label: "Save",
      onPress: () => {},
      variant: "primary",
    };

    const common: PrimitiveCommonProps = { label: "Title" };
    expect(common.label).toBe("Title");
    expect(textProps.value).toBe("hello");
    expect(selectProps.options).toHaveLength(2);
    expect(buttonProps.variant).toBe("primary");
  });
});
