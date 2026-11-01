import { isRuntimeCrash, violationsOf } from "./boot-validator/boot-report.ts";
import type { BootViolation } from "./boot-validator/boot-rule.ts";

// Collect mode is on globalThis (plain records, no Error instances) so that a schema.ts
// resolving a second installed framework copy still reports into the same collector.
const COLLECTOR_KEY = Symbol.for("kumiko.boot.definitionViolationCollector");

function activeCollector(): BootViolation[] | undefined {
  const existing: unknown = Reflect.get(globalThis, COLLECTOR_KEY);
  return Array.isArray(existing) ? existing : undefined;
}

export type DefinitionLoadOutcome<T> =
  | { readonly loaded: true; readonly value: T }
  | { readonly loaded: false; readonly thrown: unknown };

export async function collectDefinitionViolations<T>(load: () => Promise<T>): Promise<{
  readonly violations: readonly BootViolation[];
  readonly outcome: DefinitionLoadOutcome<T>;
}> {
  const previous = activeCollector();
  const violations: BootViolation[] = [];
  Reflect.set(globalThis, COLLECTOR_KEY, violations);
  try {
    const value = await load();
    return { violations, outcome: { loaded: true, value } };
  } catch (thrown) {
    return { violations, outcome: { loaded: false, thrown } };
  } finally {
    Reflect.set(globalThis, COLLECTOR_KEY, previous);
  }
}

// Outside collect mode the step runs untouched and throws on the first problem. In collect
// mode a failing step is recorded and yields undefined, so the caller carries on to the next one.
export function runDefinitionStep<T>(feature: string, check: string, step: () => T): T | undefined {
  const collector = activeCollector();
  if (collector === undefined) return step();
  try {
    return step();
  } catch (thrown) {
    if (isRuntimeCrash(thrown)) {
      // Follow-up of an earlier violation (a failed step returned undefined); without one it is a real bug.
      if (collector.length === 0) throw thrown;
      return undefined;
    }
    if (thrown instanceof Error) collector.push(...violationsOf(thrown, check, feature));
    return undefined;
  }
}

type Callable = (...args: never[]) => unknown;

function isCallable(value: unknown): value is Callable {
  return typeof value === "function";
}

function collectingFunction(feature: string, label: string, target: Callable): Callable {
  return new Proxy(target, {
    apply: (fn, thisArg, args) =>
      runDefinitionStep(feature, label, () => Reflect.apply(fn, thisArg, args)),
    get(fn, prop, receiver) {
      const value: unknown = Reflect.get(fn, prop, receiver);
      if (!isCallable(value) || !Object.hasOwn(fn, prop)) return value;
      return collectingFunction(feature, `${label}.${String(prop)}`, value);
    },
  });
}

// Wrapped only while collecting, so every other path keeps the plain registrar object.
export function collectingRegistrar<R extends object>(feature: string, registrar: R): R {
  if (activeCollector() === undefined) return registrar;
  return new Proxy(registrar, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (!isCallable(value)) return value;
      return collectingFunction(feature, `r.${String(prop)}`, value);
    },
  });
}
