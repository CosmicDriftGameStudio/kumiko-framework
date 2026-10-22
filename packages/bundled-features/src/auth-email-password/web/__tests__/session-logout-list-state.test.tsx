import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { type SessionApi, SessionProvider, useSession } from "../session.tsx";

let session: SessionApi | undefined;

function SessionProbe(): ReactNode {
  session = useSession();
  return null;
}

describe("logout forgets remembered list state", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    document.cookie = "kumiko_csrf=logout-test-token; path=/";
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/tenants") {
        return new Response(JSON.stringify({ tenants: [], activeTenantId: "t1" }), { status: 200 });
      }
      if (url === "/api/query") {
        return new Response(
          JSON.stringify({
            data: { id: "u1", email: "a@example.com", displayName: "A", roles: "[]" },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    document.cookie = "kumiko_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    globalThis.fetch = originalFetch;
    window.sessionStorage.clear();
  });

  test("logout() removes every kumiko.list.* entry and keeps foreign keys", async () => {
    window.sessionStorage.setItem("kumiko.list.t1.u1.orders", '{"params":{"q":"acme"}}');
    window.sessionStorage.setItem("kumiko.list.identity", "t1.u1");
    window.sessionStorage.setItem("other.app.key", "keep");
    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );
    await waitFor(() => expect(session?.status).toBe("authenticated"));

    await act(async () => {
      await session?.logout();
    });

    const remaining = Array.from({ length: window.sessionStorage.length }, (_, i) =>
      window.sessionStorage.key(i),
    );
    expect(remaining).toEqual(["other.app.key"]);
  });
});
