import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loginFailureMessageKey, mountStaticLoginForm } from "../static-login-dom.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.innerHTML = "";
});

function stubFetch(...responses: Response[]): { calls: number } {
  const state = { calls: 0 };
  // fetch also carries preconnect, a hint the stub has no use for; the real one keeps the type whole.
  globalThis.fetch = Object.assign(
    async () => {
      const response = responses[state.calls];
      state.calls += 1;
      if (response === undefined) throw new Error("unexpected fetch");
      return response;
    },
    { preconnect: realFetch.preconnect },
  );
  return state;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function failureBody(reason: string): unknown {
  return { isSuccess: false, error: { code: "x", details: { reason } } };
}

const loginSuccess = { isSuccess: true, token: "t", user: { id: "u" } };

const messages = {
  invalidCredentials: "bad credentials",
  rateLimited: "slow down",
  emailNotVerified: "verify email",
  accountLocked: "locked",
  mfaSetupRequired: "set up mfa",
  invalidMfaCode: "bad code",
  network: "offline",
};

const MARKUP = `
  <form data-login-form="credentials">
    <input name="email" /><input name="password" type="password" />
    <button type="submit">go</button>
    <a data-login-forgot href="/forgot">forgot</a>
    <p data-error></p>
  </form>
  <form data-login-form="mfa" hidden>
    <input name="code" />
    <button type="submit">verify</button>
    <button type="button" data-login-mfa-back>back</button>
    <p data-error></p>
  </form>`;

const navigated: string[] = [];

function mount(): { credentials: HTMLFormElement; mfa: HTMLFormElement } {
  document.body.innerHTML = MARKUP;
  mountStaticLoginForm(document.body, {
    messages,
    isAppPath: (path) => path.startsWith("/app"),
    fallbackPath: "/app",
    navigate: (path) => navigated.push(path),
  });
  const credentials = document.querySelector<HTMLFormElement>('[data-login-form="credentials"]');
  const mfa = document.querySelector<HTMLFormElement>('[data-login-form="mfa"]');
  if (credentials === null || mfa === null) throw new Error("markup missing");
  return { credentials, mfa };
}

function input(form: HTMLFormElement, name: string): HTMLInputElement {
  const element = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (element === null) throw new Error(`no input ${name}`);
  return element;
}

function errorText(form: HTMLFormElement): string {
  return form.querySelector("[data-error]")?.textContent ?? "";
}

async function submit(form: HTMLFormElement): Promise<void> {
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function fillCredentials(form: HTMLFormElement): void {
  input(form, "email").value = " a@b.de ";
  input(form, "password").value = "pw";
}

beforeEach(() => {
  navigated.length = 0;
});

describe("mountStaticLoginForm", () => {
  test("an empty email shows the invalid-credentials message without a request", async () => {
    const fetchState = stubFetch();
    const { credentials } = mount();
    input(credentials, "password").value = "pw";
    await submit(credentials);
    expect(errorText(credentials)).toBe(messages.invalidCredentials);
    expect(fetchState.calls).toBe(0);
  });

  test("a successful login navigates to the landing path", async () => {
    stubFetch(json({ ...loginSuccess, landingPath: "/app/x" }));
    const { credentials } = mount();
    fillCredentials(credentials);
    await submit(credentials);
    expect(navigated).toEqual(["/app/x"]);
  });

  test("an MFA challenge swaps the forms and the code login navigates", async () => {
    stubFetch(
      json({ isSuccess: true, mfaRequired: true, challengeToken: "c1" }),
      json(loginSuccess),
    );
    const { credentials, mfa } = mount();
    fillCredentials(credentials);
    await submit(credentials);
    expect(credentials.hidden).toBe(true);
    expect(mfa.hidden).toBe(false);
    input(mfa, "code").value = "123456";
    await submit(mfa);
    expect(navigated).toEqual(["/app"]);
  });

  test("a locked account shows its message and re-enables the controls", async () => {
    stubFetch(json(failureBody("account_locked")));
    const { credentials } = mount();
    fillCredentials(credentials);
    await submit(credentials);
    expect(errorText(credentials)).toBe(messages.accountLocked);
    for (const control of credentials.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "button, input",
    )) {
      expect(control.disabled).toBe(false);
    }
  });

  test("an unknown MFA failure shows the invalid-code message and clears the code", async () => {
    stubFetch(
      json({ isSuccess: true, mfaRequired: true, challengeToken: "c1" }),
      json(failureBody("something_else")),
    );
    const { credentials, mfa } = mount();
    fillCredentials(credentials);
    await submit(credentials);
    input(mfa, "code").value = "000000";
    await submit(mfa);
    expect(errorText(mfa)).toBe(messages.invalidMfaCode);
    expect(input(mfa, "code").value).toBe("");
  });

  test("the MFA back button returns to the credentials form with an empty password", async () => {
    stubFetch(json({ isSuccess: true, mfaRequired: true, challengeToken: "c1" }));
    const { credentials, mfa } = mount();
    fillCredentials(credentials);
    await submit(credentials);
    mfa.querySelector<HTMLElement>("[data-login-mfa-back]")?.click();
    expect(credentials.hidden).toBe(false);
    expect(mfa.hidden).toBe(true);
    expect(input(credentials, "password").value).toBe("");
  });

  test("markup without the MFA form throws", () => {
    document.body.innerHTML = `<form data-login-form="credentials"></form>`;
    expect(() =>
      mountStaticLoginForm(document.body, {
        messages,
        isAppPath: () => true,
        fallbackPath: "/app",
      }),
    ).toThrow('mountStaticLoginForm: missing form[data-login-form="mfa"]');
  });
});

describe("loginFailureMessageKey", () => {
  test("rate limit and network map the same in both steps", () => {
    for (const step of ["credentials", "mfa"] as const) {
      expect(loginFailureMessageKey("rate_limited", step)).toBe("rateLimited");
      expect(loginFailureMessageKey("network", step)).toBe("network");
    }
  });

  test("credential-only reasons map only in the credentials step", () => {
    expect(loginFailureMessageKey("email_not_verified", "credentials")).toBe("emailNotVerified");
    expect(loginFailureMessageKey("email_not_verified", "mfa")).toBe("invalidMfaCode");
  });

  test("an unknown reason falls back per step", () => {
    expect(loginFailureMessageKey("whatever", "credentials")).toBe("invalidCredentials");
    expect(loginFailureMessageKey("whatever", "mfa")).toBe("invalidMfaCode");
  });
});
