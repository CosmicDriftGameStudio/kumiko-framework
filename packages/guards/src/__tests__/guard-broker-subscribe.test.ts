import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { collectBrokerSubscribeViolations, isAllowed } from "../guard-broker-subscribe";

function sourceAt(filePath: string, code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(filePath, code);
}

describe("guard-broker-subscribe allowlist", () => {
  test("permits broker plumbing in framework pipeline", () => {
    expect(isAllowed(`${process.cwd()}/packages/framework/src/pipeline/event-dispatcher.ts`)).toBe(
      true,
    );
  });

  test("allowlist greift cwd-unabhängig (Parent-Root-Präfix)", () => {
    expect(isAllowed("kumiko-framework/packages/framework/src/pipeline/dispatcher.ts")).toBe(true);
  });

  test("blocks feature + sample code", () => {
    expect(isAllowed(`${process.cwd()}/packages/bundled-features/src/audit/feature.ts`)).toBe(
      false,
    );
    expect(isAllowed(`${process.cwd()}/samples/apps/foo/src/feature.ts`)).toBe(false);
  });
});

describe("collectBrokerSubscribeViolations", () => {
  const FEATURE = `${process.cwd()}/packages/bundled-features/src/x/feature.ts`;

  test("flags broker.subscribe(...)", () => {
    const sf = sourceAt(
      FEATURE,
      `declare const broker: { subscribe: (e: string, h: () => void) => void };
       export function reg() { broker.subscribe("task.created", () => {}); }`,
    );
    expect(collectBrokerSubscribeViolations(sf)).toHaveLength(1);
  });

  test("flags eventBroker.subscribe(...)", () => {
    const sf = sourceAt(
      FEATURE,
      `declare const eventBroker: { subscribe: (e: string, h: () => void) => void };
       export function reg() { eventBroker.subscribe("x", () => {}); }`,
    );
    expect(collectBrokerSubscribeViolations(sf)).toHaveLength(1);
  });

  test("flags member-access receiver (ctx.eventBroker / this.broker)", () => {
    const sf = sourceAt(
      FEATURE,
      `export function a(ctx: any) { ctx.eventBroker.subscribe("x", () => {}); }
       export class C { b() { (this as any).broker.subscribe("y", () => {}); } }`,
    );
    expect(collectBrokerSubscribeViolations(sf)).toHaveLength(2);
  });

  test("does NOT flag store/observable .subscribe (RxJS, React controller)", () => {
    const sf = sourceAt(
      FEATURE,
      `declare const controller: { subscribe: (f: () => void) => void };
       declare const store: { subscribe: (f: () => void) => void };
       export function r() {
         controller.subscribe(() => {});
         store.subscribe(() => {});
       }`,
    );
    expect(collectBrokerSubscribeViolations(sf)).toHaveLength(0);
  });

  // Boundary: nur die kanonischen Namen broker/eventBroker werden erkannt.
  // slips through — accepted because no such broker exists today; extend the
  // regex when one appears.
  test("does NOT flag a differently-named broker (documented boundary)", () => {
    const sf = sourceAt(
      FEATURE,
      `declare const messageBroker: { subscribe: (e: string, h: () => void) => void };
       export function r() { messageBroker.subscribe("x", () => {}); }`,
    );
    expect(collectBrokerSubscribeViolations(sf)).toHaveLength(0);
  });
});
