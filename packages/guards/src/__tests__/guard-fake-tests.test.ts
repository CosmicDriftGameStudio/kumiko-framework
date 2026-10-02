import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-fake-tests";

function run(source: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("src/__tests__/fixture.test.ts", source);
  return guard.run([sf]).violations;
}

describe("guard-fake-tests — assertion API methods", () => {
  test("stack.http.writeOk(...) counts as an assertion", () => {
    const violations = run(`
      test("writes ok", () => {
        stack.http.writeOk("/x", {});
      });
    `);
    expect(violations).toHaveLength(0);
  });

  test("tenant.api.queryErr(...) counts as an assertion", () => {
    const violations = run(`
      test("query fails", () => {
        tenant.api.queryErr("/x");
      });
    `);
    expect(violations).toHaveLength(0);
  });

  test("waitFor(() => screen.getByTestId(...)) alone is a violation — not treated as an assertion", () => {
    const violations = run(`
      test("shows the banner", async () => {
        await waitFor(() => screen.getByTestId("banner"));
      });
    `);
    expect(violations).toHaveLength(1);
  });
});

describe("guard-fake-tests — same-file helper resolution", () => {
  test("a same-file helper that asserts clears the test", () => {
    const violations = run(`
      function assertThing() {
        expect(2 + 2).toBe(4);
      }
      test("uses a helper", () => {
        assertThing();
      });
    `);
    expect(violations).toHaveLength(0);
  });

  test("a helper calling a helper calling expect (depth 2) clears the test", () => {
    const violations = run(`
      function inner() {
        expect(2 + 2).toBe(4);
      }
      function outer() {
        inner();
      }
      test("uses a two-deep helper", () => {
        outer();
      });
    `);
    expect(violations).toHaveLength(0);
  });

  test("a helper chain deeper than the depth limit is a violation", () => {
    const violations = run(`
      function h4() {
        expect(2 + 2).toBe(4);
      }
      function h3() {
        h4();
      }
      function h2() {
        h3();
      }
      function h1() {
        h2();
      }
      test("chain too deep", () => {
        h1();
      });
    `);
    expect(violations).toHaveLength(1);
  });

  test("a helper first seen at the depth limit is re-explored when called directly later", () => {
    const violations = run(`
      function inner() {
        expect(2 + 2).toBe(4);
      }
      function helper() {
        inner();
      }
      function c2() {
        helper();
      }
      function c1() {
        c2();
      }
      test("reaches helper deep first, then directly", () => {
        c1();
        helper();
      });
    `);
    expect(violations).toHaveLength(0);
  });

  test("a same-named helper nested in another scope does not clear the call to the file-level one", () => {
    const violations = run(`
      function other() {
        function check() {
          expect(2 + 2).toBe(4);
        }
        check();
      }
      function check() {
        doSomething();
      }
      test("calls the silent file-level check", () => {
        check();
      });
    `);
    expect(violations).toHaveLength(1);
  });

  test("a recursive helper without an assertion is a violation, not an infinite loop", () => {
    const violations = run(`
      function loop() {
        loop();
      }
      test("recurses forever, asserts nothing", () => {
        loop();
      });
    `);
    expect(violations).toHaveLength(1);
  });

  test("a same-file helper without an assertion is a violation", () => {
    const violations = run(`
      function noop() {
        doSomething();
      }
      test("uses a silent helper", () => {
        noop();
      });
    `);
    expect(violations).toHaveLength(1);
  });

  test("writeOkish() and foo.writeOkay() are not the real assertion API and are violations", () => {
    const violations = run(`
      test("looks like an assertion but isn't (a)", () => {
        writeOkish();
      });
      test("looks like an assertion but isn't (b)", () => {
        foo.writeOkay();
      });
    `);
    expect(violations).toHaveLength(2);
  });

  test("an imported (not same-file) helper is unproven and a violation", () => {
    const violations = run(`
      import { assertThing } from "./helpers";
      test("uses an imported helper", () => {
        assertThing();
      });
    `);
    expect(violations).toHaveLength(1);
  });
});
