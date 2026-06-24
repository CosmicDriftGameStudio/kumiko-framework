/** Shared marketing chrome for apex auth surface previews. */

const BASE_STYLE = `
  :root { --bg:#f8fafc; --card:#fff; --border:#e2e8f0; --fg:#0f172a; --muted:#64748b; --primary:#4f46e5; --primary-fg:#fff; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--fg); line-height: 1.5; }
  header { display:flex; align-items:center; justify-content:space-between; padding:1rem 2rem; border-bottom:1px solid var(--border); background:#fff; }
  header a { color: var(--muted); text-decoration:none; margin-left:1rem; font-size:.875rem; }
  header .brand { font-weight:700; color: var(--fg); margin-left:0; }
  main { padding: 3rem 1rem; display:flex; justify-content:center; }
  .card { width:100%; max-width:24rem; background:var(--card); border:1px solid var(--border); border-radius:.75rem; box-shadow:0 8px 24px rgba(15,23,42,.08); overflow:hidden; }
  .card h1 { margin:0; font-size:1.25rem; font-weight:600; }
  .card .sub { margin:.25rem 0 0; font-size:.875rem; color:var(--muted); }
  .card-head { padding:1.5rem 1.5rem 1rem; }
  .card-body { padding:0 1.5rem 1.5rem; }
  label { display:block; font-size:.875rem; font-weight:500; margin-bottom:.35rem; }
  input { width:100%; padding:.55rem .75rem; border:1px solid var(--border); border-radius:.5rem; margin-bottom:1rem; font-size:.875rem; background:#fff; }
  .btn { display:block; width:100%; text-align:center; padding:.65rem 1rem; border-radius:.5rem; background:var(--primary); color:var(--primary-fg); font-weight:600; border:none; font-size:.875rem; }
  .links { margin-top:1rem; font-size:.875rem; text-align:center; }
  .links a { color:var(--primary); text-decoration:none; }
  .muted { color:var(--muted); }
  .banner { background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:.75rem; border-radius:.5rem; font-size:.875rem; margin-bottom:1rem; }
  .legal { margin-top:1.25rem; padding-top:1rem; border-top:1px solid var(--border); font-size:.75rem; text-align:center; }
  .legal a { color:var(--muted); margin:0 .5rem; }
  p.note { font-size:.875rem; color:var(--muted); margin:0 0 1rem; }
`;

export function wrapAuthSurface(title: string, subtitle: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>${BASE_STYLE}</style>
</head>
<body>
  <header>
    <a class="brand" href="/">Tasklane</a>
    <nav>
      <a href="#features">Features</a>
      <a href="#pricing">Pricing</a>
      <a href="/login">Sign in</a>
    </nav>
  </header>
  <main>
    <div class="card">
      <div class="card-head">
        <h1>${title}</h1>
        <p class="sub">${subtitle}</p>
      </div>
      <div class="card-body">${body}</div>
    </div>
  </main>
</body>
</html>`;
}

export function getAuthLoginHtml(): string {
  return wrapAuthSurface(
    "Sign in",
    "Welcome back — use your work email.",
    `<label for="email">Email</label>
     <input id="email" type="email" value="admin@acme.example" readonly />
     <label for="password">Password</label>
     <input id="password" type="password" value="••••••••" readonly />
     <button type="button" class="btn">Sign in</button>
     <div class="links">
       <a href="/forgot-password">Forgot password?</a>
       <span class="muted"> · </span>
       <a href="/signup">Create account</a>
     </div>
     <div class="legal">
       <a href="/legal/impressum">Imprint</a>
       <a href="/legal/datenschutz">Privacy</a>
     </div>`,
  );
}

export function getAuthSignupHtml(): string {
  return wrapAuthSurface(
    "Create account",
    "Start free — one tenant, invite your team later.",
    `<label for="name">Full name</label>
     <input id="name" value="Alex Admin" readonly />
     <label for="email">Work email</label>
     <input id="email" type="email" value="alex@acme.example" readonly />
     <label for="password">Password</label>
     <input id="password" type="password" value="••••••••" readonly />
     <p class="note">By signing up you agree to the privacy policy. A verification email is sent before the first login.</p>
     <button type="button" class="btn">Create account</button>
     <div class="links"><span class="muted">Already have an account?</span> <a href="/login">Sign in</a></div>`,
  );
}

export function getAuthForgotPasswordHtml(): string {
  return wrapAuthSurface(
    "Reset password",
    "We email a one-time link — no password hint that leaks account existence.",
    `<label for="email">Email</label>
     <input id="email" type="email" value="alex@acme.example" readonly />
     <button type="button" class="btn">Send reset link</button>
     <div class="links"><a href="/login">Back to sign in</a></div>`,
  );
}

export function getAuthDeleteAccountHtml(): string {
  return wrapAuthSurface(
    "Delete account",
    "GDPR Art. 17 — works even when you cannot sign in (email verification).",
    `<p class="note">Enter the email on your account. If it exists, we send a magic link to confirm deletion after a grace period.</p>
     <label for="email">Email</label>
     <input id="email" type="email" value="alex@acme.example" readonly />
     <button type="button" class="btn">Request deletion link</button>
     <div class="links"><a href="/login">Sign in instead</a></div>`,
  );
}
