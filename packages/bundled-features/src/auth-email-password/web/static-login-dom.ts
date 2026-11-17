// DOM binding of the static login for plain site scripts (Astro); same import limits as static-login.ts.

import { STATIC_NETWORK_REASON, STATIC_RATE_LIMITED_REASON } from "./static-client.ts";
import {
  forgotPasswordHref,
  type IsAppPath,
  loginWithPassword,
  postLoginPath,
  type StaticAuthResult,
  verifyMfaCode,
} from "./static-login.ts";

export const LOGIN_FAILURE_MESSAGE_KEYS = [
  "invalidCredentials",
  "rateLimited",
  "emailNotVerified",
  "accountLocked",
  "mfaSetupRequired",
  "invalidMfaCode",
  "network",
] as const;
export type LoginFailureMessageKey = (typeof LOGIN_FAILURE_MESSAGE_KEYS)[number];
export type LoginFailureMessages = Readonly<Record<LoginFailureMessageKey, string>>;
export type LoginStep = "credentials" | "mfa";

const SHARED_REASON_KEYS: Readonly<Record<string, LoginFailureMessageKey>> = {
  [STATIC_RATE_LIMITED_REASON]: "rateLimited",
  [STATIC_NETWORK_REASON]: "network",
};

const CREDENTIAL_REASON_KEYS: Readonly<Record<string, LoginFailureMessageKey>> = {
  ...SHARED_REASON_KEYS,
  email_not_verified: "emailNotVerified",
  account_locked: "accountLocked",
};

function keyOf(
  keys: Readonly<Record<string, LoginFailureMessageKey>>,
  reason: string,
): LoginFailureMessageKey | undefined {
  return Object.hasOwn(keys, reason) ? keys[reason] : undefined;
}

export function loginFailureMessageKey(reason: string, step: LoginStep): LoginFailureMessageKey {
  if (step === "mfa") return keyOf(SHARED_REASON_KEYS, reason) ?? "invalidMfaCode";
  return keyOf(CREDENTIAL_REASON_KEYS, reason) ?? "invalidCredentials";
}

export function isLoginFailureMessages(value: unknown): value is LoginFailureMessages {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return LOGIN_FAILURE_MESSAGE_KEYS.every((key) => typeof record[key] === "string");
}

export type StaticLoginFormOptions = {
  readonly messages: LoginFailureMessages;
  readonly isAppPath: IsAppPath;
  readonly fallbackPath: string;
  readonly navigate?: (path: string) => void;
};

function requireElement<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) throw new Error(`mountStaticLoginForm: missing ${selector}`);
  return element;
}

function inputOf(form: HTMLFormElement, name: string): HTMLInputElement | null {
  return form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
}

function setBusy(form: HTMLFormElement, busy: boolean): void {
  for (const control of form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    "button, input",
  )) {
    control.disabled = busy;
  }
}

function setErrorText(form: HTMLFormElement, text: string): void {
  const slot = form.querySelector<HTMLElement>("[data-error]");
  if (slot !== null) slot.textContent = text;
}

export function mountStaticLoginForm(root: ParentNode, options: StaticLoginFormOptions): void {
  const { messages, isAppPath, fallbackPath } = options;
  const navigate = options.navigate ?? ((path: string) => window.location.assign(path));
  const credentials = requireElement<HTMLFormElement>(root, 'form[data-login-form="credentials"]');
  const mfa = requireElement<HTMLFormElement>(root, 'form[data-login-form="mfa"]');
  const mfaBack = requireElement<HTMLElement>(mfa, "[data-login-mfa-back]");
  const forgotLink = root.querySelector<HTMLAnchorElement>("a[data-login-forgot]");
  let challengeToken = "";

  if (forgotLink !== null) {
    forgotLink.href = forgotPasswordHref(
      forgotLink.getAttribute("href") ?? "",
      window.location.search,
      isAppPath,
    );
  }

  const showError = (form: HTMLFormElement, key: LoginFailureMessageKey): void =>
    setErrorText(form, messages[key]);

  const finish = (form: HTMLFormElement, step: LoginStep, result: StaticAuthResult): void => {
    if (result.kind === "success") {
      navigate(
        postLoginPath({
          search: window.location.search,
          landingPath: result.landingPath,
          isAppPath,
          fallbackPath,
        }),
      );
      return;
    }
    setBusy(form, false);
    if (result.kind === "mfa-challenge") {
      challengeToken = result.challengeToken;
      credentials.hidden = true;
      mfa.hidden = false;
      inputOf(mfa, "code")?.focus();
      return;
    }
    showError(
      form,
      result.kind === "mfa-setup-required"
        ? "mfaSetupRequired"
        : loginFailureMessageKey(result.reason, step),
    );
    if (step === "mfa") {
      const code = inputOf(mfa, "code");
      if (code !== null) {
        code.value = "";
        code.focus();
      }
    }
  };

  credentials.addEventListener("submit", async (event) => {
    event.preventDefault();
    setErrorText(credentials, "");
    const email = inputOf(credentials, "email")?.value.trim() ?? "";
    const password = inputOf(credentials, "password")?.value ?? "";
    if (email === "" || password === "") {
      showError(credentials, "invalidCredentials");
      return;
    }
    setBusy(credentials, true);
    finish(credentials, "credentials", await loginWithPassword(email, password));
  });

  mfa.addEventListener("submit", async (event) => {
    event.preventDefault();
    setErrorText(mfa, "");
    const code = inputOf(mfa, "code")?.value.trim() ?? "";
    if (code === "") {
      showError(mfa, "invalidMfaCode");
      return;
    }
    setBusy(mfa, true);
    finish(mfa, "mfa", await verifyMfaCode(challengeToken, code));
  });

  mfaBack.addEventListener("click", () => {
    challengeToken = "";
    setErrorText(mfa, "");
    mfa.hidden = true;
    credentials.hidden = false;
    const password = inputOf(credentials, "password");
    if (password !== null) {
      password.value = "";
      password.focus();
    }
  });
}
