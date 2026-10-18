import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { useOptionalCurrentUser } from "@cosmicdrift/kumiko-renderer";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SessionProvider, useSession } from "../session.tsx";

function CurrentUserProbe(): ReactNode {
  const user = useOptionalCurrentUser();
  return <div data-testid="probe">{user === undefined ? "none" : JSON.stringify(user)}</div>;
}

describe("SessionProvider provides the renderer's current user", () => {
  const originalFetch = globalThis.fetch;

  function mockBackend(meData: Record<string, unknown> | null): void {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/tenants") {
        return new Response(JSON.stringify({ tenants: [], activeTenantId: "t1" }), { status: 200 });
      }
      if (url === "/api/query") {
        return meData === null
          ? new Response(null, { status: 401 })
          : new Response(JSON.stringify({ data: meData }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
  }

  beforeEach(() => {
    document.cookie = "kumiko_csrf=current-user-test-token";
  });

  afterEach(() => {
    document.cookie = "kumiko_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    globalThis.fetch = originalFetch;
  });

  test("a signed-in session exposes id, email, displayName and the effective time zone", async () => {
    mockBackend({
      id: "u1",
      email: "ines@example.com",
      displayName: "Ines",
      effectiveTimeZone: "Europe/Berlin",
      roles: "[]",
    });
    render(
      <SessionProvider>
        <CurrentUserProbe />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("probe").textContent).not.toBe("none");
    });
    expect(JSON.parse(screen.getByTestId("probe").textContent ?? "")).toEqual({
      id: "u1",
      email: "ines@example.com",
      displayName: "Ines",
      timeZone: "Europe/Berlin",
    });
  });

  test("a signed-out session exposes no current user", async () => {
    mockBackend(null);
    render(
      <SessionProvider>
        <CurrentUserProbe />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(
        (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls.length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByTestId("probe").textContent).toBe("none");
  });
});

describe("CurrentUser reference stability", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("a refresh that returns an identical profile keeps the same CurrentUser reference", async () => {
    document.cookie = "kumiko_csrf=current-user-test-token";
    // Fresh response objects per call, so the profile object differs each time.
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/auth/tenants") {
        return new Response(JSON.stringify({ tenants: [], activeTenantId: "t1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          data: { id: "u1", email: "a@example.com", displayName: "A", roles: "[]" },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const seen: unknown[] = [];
    let refresh: (() => Promise<void>) | undefined;
    function Probe(): ReactNode {
      const user = useOptionalCurrentUser();
      refresh = useSession().refresh;
      if (user !== undefined && seen[seen.length - 1] !== user) seen.push(user);
      return null;
    }
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => {
      expect(seen).toHaveLength(1);
    });
    await act(async () => {
      await refresh?.();
    });
    expect(seen).toHaveLength(1);
  });
});
