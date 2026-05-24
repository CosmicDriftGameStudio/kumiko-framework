import { describe, expect, test } from "bun:test";
import { createFormController } from "../form-controller";

describe("createFormController — core state machine", () => {
  test("initial state: values === initial, no changes, not dirty, no errors", () => {
    const form = createFormController({ initial: { title: "hello", count: 3 } });
    const snap = form.getSnapshot();

    expect(snap.values).toEqual({ title: "hello", count: 3 });
    expect(snap.initial).toEqual({ title: "hello", count: 3 });
    expect(snap.changes).toEqual({});
    expect(snap.isDirty).toBe(false);
    expect(snap.isUnchanged).toBe(true);
    expect(snap.errors).toEqual({});
  });

  test("setField: tracks the single-field change and flips isDirty", () => {
    const form = createFormController({ initial: { title: "hello", count: 3 } });

    form.setField("title", "world");
    const snap = form.getSnapshot();

    expect(snap.values.title).toBe("world");
    expect(snap.values.count).toBe(3);
    expect(snap.initial.title).toBe("hello"); // baseline unchanged
    expect(snap.changes).toEqual({ title: "world" });
    expect(snap.isDirty).toBe(true);
    expect(snap.isUnchanged).toBe(false);
  });

  test("setField to same value is a no-op: no new snapshot, no listener fires", () => {
    const form = createFormController({ initial: { title: "hello" } });
    const before = form.getSnapshot();
    const listener = mock();
    form.subscribe(listener);

    form.setField("title", "hello");

    expect(form.getSnapshot()).toBe(before); // identity preserved
    expect(listener).not.toHaveBeenCalled();
  });

  test("typing back to the initial value clears the change from `changes`", () => {
    const form = createFormController({ initial: { title: "hello" } });

    form.setField("title", "world");
    expect(form.getSnapshot().changes).toEqual({ title: "world" });

    form.setField("title", "hello");
    const snap = form.getSnapshot();
    expect(snap.changes).toEqual({});
    expect(snap.isDirty).toBe(false);
  });

  test("setValues: bulk update fires one notify, one snapshot rebuild", () => {
    const form = createFormController({ initial: { a: 1, b: 2, c: 3 } });
    const listener = mock();
    form.subscribe(listener);

    form.setValues({ a: 10, b: 20 });

    expect(form.getSnapshot().changes).toEqual({ a: 10, b: 20 });
    expect(listener).toHaveBeenCalledTimes(1); // not 2
  });

  test("setValues with no effective changes is a no-op", () => {
    const form = createFormController({ initial: { a: 1, b: 2 } });
    const before = form.getSnapshot();
    const listener = mock();
    form.subscribe(listener);

    form.setValues({ a: 1 });

    expect(form.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("subscribe/unsubscribe: listener stops firing after unsubscribe", () => {
    const form = createFormController({ initial: { title: "hello" } });
    const listener = mock();
    const unsubscribe = form.subscribe(listener);

    form.setField("title", "world");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    form.setField("title", "again");
    expect(listener).toHaveBeenCalledTimes(1); // still 1
  });

  test("getSnapshot returns stable reference between mutators", () => {
    const form = createFormController({ initial: { title: "hello" } });

    const a = form.getSnapshot();
    const b = form.getSnapshot();
    expect(a).toBe(b); // identity compare — required for useSyncExternalStore

    form.setField("title", "world");
    const c = form.getSnapshot();
    expect(c).not.toBe(a); // mutation produced a new snapshot
  });

  test("snapshot is frozen — mutating it throws in strict mode", () => {
    const form = createFormController({ initial: { title: "hello" } });
    const snap = form.getSnapshot();

    expect(() => {
      (snap as unknown as { values: unknown }).values = {};
    }).toThrow();
  });

  test("reset: restores values to initial and clears errors", () => {
    const form = createFormController({ initial: { title: "hello", count: 3 } });
    form.setField("title", "world");
    form.setErrors({ title: [{ path: "title", code: "bad", i18nKey: "x" }] });

    form.reset();
    const snap = form.getSnapshot();

    expect(snap.values).toEqual({ title: "hello", count: 3 });
    expect(snap.isDirty).toBe(false);
    expect(snap.errors).toEqual({});
  });

  test("reset is a no-op when already clean and error-free", () => {
    const form = createFormController({ initial: { title: "hello" } });
    const before = form.getSnapshot();
    const listener = mock();
    form.subscribe(listener);

    form.reset();

    expect(form.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("rebase: current values become the new baseline, changes collapse to {}", () => {
    const form = createFormController({ initial: { title: "hello" } });
    form.setField("title", "world");
    expect(form.getSnapshot().changes).toEqual({ title: "world" });

    form.rebase();
    const snap = form.getSnapshot();

    expect(snap.values.title).toBe("world");
    expect(snap.initial.title).toBe("world"); // baseline updated
    expect(snap.changes).toEqual({});
    expect(snap.isDirty).toBe(false);
  });

  test("setErrors + clearErrors(path): targeted removal leaves other errors alone", () => {
    const form = createFormController({ initial: { a: "", b: "" } });
    form.setErrors({
      a: [{ path: "a", code: "required", i18nKey: "x" }],
      b: [{ path: "b", code: "required", i18nKey: "x" }],
    });

    form.clearErrors("a");
    const snap = form.getSnapshot();

    expect(snap.errors["a"]).toBeUndefined();
    expect(snap.errors["b"]).toBeDefined();
  });

  test("clearErrors() without path wipes everything", () => {
    const form = createFormController({ initial: { a: "" } });
    form.setErrors({ a: [{ path: "a", code: "required", i18nKey: "x" }] });

    form.clearErrors();

    expect(form.getSnapshot().errors).toEqual({});
  });

  test("mutating the input object after create does not bleed into controller state", () => {
    const initial = { title: "hello" };
    const form = createFormController({ initial });

    initial.title = "mutated-from-outside";

    expect(form.getSnapshot().initial.title).toBe("hello");
    expect(form.getSnapshot().values.title).toBe("hello");
  });

  test("deleted field via setValues({ key: undefined }) still counts as a change", () => {
    // Covers the both-sides iteration in valuesDiff — a field cleared from
    // the current values still diverges from initial and shows up in changes.
    const form = createFormController({ initial: { title: "hello" } });
    form.setValues({ title: undefined });

    const snap = form.getSnapshot();
    expect(snap.isDirty).toBe(true);
    expect("title" in snap.changes).toBe(true);
    expect(snap.changes["title"]).toBeUndefined();
  });
});
