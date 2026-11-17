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

  test("waitFor(() => screen.getByTestId(...)) counts as an assertion — the query throws until it matches", () => {
    const violations = run(`
      test("shows the banner", async () => {
        await waitFor(() => screen.getByTestId("banner"));
      });
    `);
    expect(violations).toHaveLength(0);
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

describe("guard-fake-tests: test modifiers and self comparisons", () => {
  test("test.each without expect is a violation", () => {
    const violations = run(`
      test.each([1, 2])("case %s", (n) => { doSomething(n); });
    `);
    expect(violations).toHaveLength(1);
  });

  test("it.concurrent without expect is a violation", () => {
    const violations = run(`
      it.concurrent("x", async () => { await doSomething(); });
    `);
    expect(violations).toHaveLength(1);
  });

  test("an aliased bun:test import is recognised", () => {
    const violations = run(`
      import { test as bunTest } from "bun:test";
      bunTest.each([1])("x", () => { doSomething(); });
    `);
    expect(violations).toHaveLength(1);
  });

  test("test.each with expect passes", () => {
    const violations = run(`
      test.each([1])("x", (n) => { expect(n).toBe(1); });
    `);
    expect(violations).toHaveLength(0);
  });

  test("describe.each is not a test case", () => {
    const violations = run(`
      describe.each([1])("group", () => { doSomething(); });
    `);
    expect(violations).toHaveLength(0);
  });

  test("a value compared with itself is a tautology", () => {
    const violations = run(`
      test("t", () => { const value = 3; expect(value).toBe(value); });
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("TAUTOLOGY");
  });

  test("a determinism check with calls on both sides is allowed", () => {
    const violations = run(`
      test("t", () => { expect(stableHash("a")).toBe(stableHash("a")); });
    `);
    expect(violations).toHaveLength(0);
  });
});

describe("guard-fake-tests — existence-only checks on error results", () => {
  test("toBeDefined on a writeErr result is reported", () => {
    const violations = run(`
      test("t", async () => { const error = await stack.http.writeErr("x", {}, u); expect(error).toBeDefined(); });
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("ERROR EXISTS ONLY");
  });

  test("toBeTruthy on a field of a queryErr result is reported", () => {
    const violations = run(`
      test("t", async () => { const err = await api.queryErr("x"); expect(err.code).toBeTruthy(); });
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("ERROR EXISTS ONLY");
  });

  test("not.toBeNull on a writeErr result is reported", () => {
    const violations = run(`
      test("t", async () => { const error = await stack.http.writeErr("x", {}, u); expect(error).not.toBeNull(); });
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("ERROR EXISTS ONLY");
  });

  test("an inline awaited writeErr call is reported", () => {
    const violations = run(`
      test("t", async () => { expect(await stack.http.writeErr("x", {}, u)).toBeDefined(); });
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("ERROR EXISTS ONLY");
  });

  test("asserting the error code is allowed", () => {
    const violations = run(`
      test("t", async () => { const error = await stack.http.writeErr("x", {}, u); expect(error.code).toBe("validation_error"); });
    `);
    expect(violations).toHaveLength(0);
  });

  test("a same-named variable from another call is resolved by symbol, not by name", () => {
    const violations = run(`
      test("one", async () => { const error = await stack.http.writeErr("x", {}, u); expect(error.code).toBe("x"); });
      test("two", async () => { const error = await stack.http.queryOk("x", {}, u); expect(error).toBeDefined(); });
    `);
    expect(violations).toHaveLength(0);
  });

  test("an existence check on a non-error result is allowed", () => {
    const violations = run(`
      test("t", async () => { const result = await guard.checkStockCap("x"); expect(result).toBeDefined(); });
    `);
    expect(violations).toHaveLength(0);
  });
});

describe("guard-fake-tests — Testing Library queries", () => {
  test("a bare getBy query counts as an assertion", () => {
    const violations = run(`
      test("t", () => { render(); screen.getByText("Saved"); });
    `);
    expect(violations).toHaveLength(0);
  });

  test("a destructured getBy query and a within(...) query count as assertions", () => {
    const violations = run(`
      test("a", () => { const { getByRole } = render(); getByRole("button"); });
      test("b", () => { within(row).getAllByTestId("cell"); });
    `);
    expect(violations).toHaveLength(0);
  });

  test("an awaited or returned findBy query counts as an assertion", () => {
    const violations = run(`
      test("a", async () => { await screen.findByText("Saved"); });
      test("b", () => { return screen.findByRole("dialog"); });
      test("c", async () => { await waitFor(() => screen.findAllByTestId("row")); });
    `);
    expect(violations).toHaveLength(0);
  });

  test("a floating findBy query is not an assertion", () => {
    const violations = run(`
      test("t", async () => { screen.findByText("Saved"); });
    `);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("NO EXPECT");
  });

  test("a bare queryBy query and a repository findById are not assertions", () => {
    const violations = run(`
      test("a", () => { screen.queryByTestId("banner"); });
      test("b", async () => { await repo.findById("x"); });
    `);
    expect(violations.map((violation) => violation.message)).toEqual([
      'NO EXPECT: "a"',
      'NO EXPECT: "b"',
    ]);
  });

  test("toBeTruthy, toBeDefined and not.toBeNull on a query are reported", () => {
    const violations = run(`
      test("a", () => { expect(screen.getByText("Saved")).toBeTruthy(); });
      test("b", async () => { expect(await screen.findByTestId("row")).toBeDefined(); });
      test("c", () => { expect(screen.getAllByRole("row")).not.toBeNull(); });
    `);
    expect(violations).toHaveLength(3);
    expect(violations.every((violation) => violation.message.includes("QUERY EXISTS ONLY"))).toBe(
      true,
    );
  });

  test("an existence check on a chained query result or a queryBy query is allowed", () => {
    const violations = run(`
      test("a", () => { expect(screen.getByTestId("field").querySelector("input")).toBeTruthy(); });
      test("b", () => { expect(screen.queryByText("Saved")).toBeTruthy(); });
    `);
    expect(violations).toHaveLength(0);
  });
});
