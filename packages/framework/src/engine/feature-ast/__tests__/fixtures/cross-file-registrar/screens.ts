// biome-ignore lint/suspicious/noExplicitAny: structural parser test fixture, never executed or type-checked at runtime
export function registerFooScreens(r: any) {
  r.nav({ id: "foo", label: "Foo" });
}
