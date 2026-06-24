const PAGE_STYLE = `
  :root { --bg:#fff; --border:#e2e8f0; --fg:#0f172a; --muted:#64748b; --accent:#4f46e5; --ok:#16a34a; --warn:#d97706; }
  body { font-family: system-ui, sans-serif; max-width: 920px; margin: 2rem auto; padding: 0 1.25rem; line-height: 1.55; color: var(--fg); }
  h1 { font-size: 1.75rem; margin-bottom: .25rem; }
  .lead { color: var(--muted); margin-bottom: 2rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 .75rem; border-bottom: 1px solid var(--border); padding-bottom: .35rem; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; margin: 1rem 0; }
  th, td { border: 1px solid var(--border); padding: .55rem .65rem; text-align: left; vertical-align: top; }
  th { background: #f8fafc; font-weight: 600; }
  .pill { display:inline-block; padding:.15rem .5rem; border-radius:999px; font-size:.75rem; font-weight:600; }
  .pill-ok { background:#dcfce7; color:#166534; }
  .pill-warn { background:#ffedd5; color:#9a3412; }
  .card { border:1px solid var(--border); border-radius:.75rem; padding:1rem 1.25rem; margin:1rem 0; background:#fafafa; }
  ul { margin: .5rem 0; padding-left: 1.25rem; }
  code { font-size: .85em; background: #f1f5f9; padding: .1rem .35rem; border-radius: .25rem; }
`;

function page(title: string, lead: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${title}</title><style>${PAGE_STYLE}</style></head>
<body><h1>${title}</h1><p class="lead">${lead}</p>${body}</body></html>`;
}

export function getTenantPreviewHtml(): string {
  return page(
    "Multi-tenant memberships",
    "The tenant feature owns tenants, memberships, and roles — every write is scoped to the active tenant.",
    `<h2>Active tenant: Acme GmbH</h2>
<table>
  <tr><th>User</th><th>Role</th><th>Since</th></tr>
  <tr><td>alex@acme.example</td><td><span class="pill pill-ok">TenantAdmin</span></td><td>2024-03-12</td></tr>
  <tr><td>sam@acme.example</td><td>Editor</td><td>2024-06-01</td></tr>
  <tr><td>bot@acme.example</td><td>User</td><td>2025-01-09</td></tr>
</table>
<div class="card"><strong>Tenant switcher</strong> in the admin UI resolves <code>X-Tenant</code> on every API call — data never leaks across tenants.</div>`,
  );
}

export function getUserPreviewHtml(): string {
  return page(
    "Cross-tenant user identity",
    "One login identity can belong to many tenants with different roles per membership.",
    `<h2>User: alex@acme.example</h2>
<table>
  <tr><th>Tenant</th><th>Role</th><th>JWT claim</th></tr>
  <tr><td>Acme GmbH</td><td>TenantAdmin</td><td><code>tenantId=acme</code></td></tr>
  <tr><td>Beta Studio</td><td>User</td><td><code>tenantId=beta</code></td></tr>
</table>
<p>The <code>user</code> feature stores the global identity; <code>tenant</code> stores memberships. Auth issues a session bound to one active tenant at a time.</p>`,
  );
}

export function getComplianceProfilesPreviewHtml(): string {
  return page(
    "Compliance profiles per tenant",
    "Same app binary — regulatory behaviour comes from the selected profile, not from if-branches in your code.",
    `<table>
  <tr><th>Tenant</th><th>Profile</th><th>Supervisory authority</th><th>Destroy grace</th></tr>
  <tr><td>DACH Corp (A)</td><td><code>eu-dsgvo</code></td><td>BlnBDI Berlin</td><td>30 days</td></tr>
  <tr><td>Swiss AG (B)</td><td><code>swiss-dsg</code></td><td>EDÖB Bern</td><td>90 days (override)</td></tr>
  <tr><td>HR GmbH (C)</td><td><code>de-hr-dsgvo-hgb</code></td><td>State DPA</td><td>60 days (HR)</td></tr>
</table>
<p><code>compliance.forTenant</code> resolves forget grace, retention strategy, and audit obligations for <code>user-data-rights</code> and lifecycle jobs.</p>`,
  );
}

export function getUserDataRightsPreviewHtml(): string {
  return page(
    "User data rights (GDPR)",
    "Export ZIP (Art. 15+20), deletion with grace (Art. 17), restriction blocks login (Art. 18) — domain hooks via <code>EXT_USER_DATA</code>.",
    `<h2>Self-service (logged in)</h2>
<ul>
  <li><strong>Export my data</strong> → ZIP with notes, audit trail, profile</li>
  <li><strong>Delete account</strong> → grace period, then <code>runForgetCleanup</code></li>
  <li><strong>Restrict processing</strong> → login blocked until lifted</li>
</ul>
<h2>Public apex (lockout-safe)</h2>
<div class="card">
  <span class="pill pill-warn">anonymous</span>
  <strong> /delete-account</strong> — email magic link, enumeration-safe, no login required.
</div>
<table>
  <tr><th>Article</th><th>Mechanism</th></tr>
  <tr><td>Art. 15 + 20</td><td><code>request-export</code> → bundled ZIP</td></tr>
  <tr><td>Art. 17</td><td>Grace → entity hooks <code>delete</code> / <code>anonymize</code></td></tr>
  <tr><td>Art. 18</td><td>Restriction flag on session</td></tr>
</table>`,
  );
}

export function getUserProfilePreviewHtml(): string {
  return page(
    "Account profile (self-service)",
    "Bundled <code>user-profile</code> screen: password, email change with re-auth, deletion cancel during grace.",
    `<div class="card">
  <h2 style="margin-top:0;border:0;padding:0">Profile</h2>
  <p><strong>Email:</strong> alex@acme.example <span class="pill pill-ok">verified</span></p>
  <p><strong>Password:</strong> •••••••• <a href="#">Change</a></p>
  <p><strong>Deletion scheduled:</strong> <span class="muted">none</span></p>
  <hr style="border:0;border-top:1px solid var(--border);margin:1rem 0" />
  <button style="padding:.5rem 1rem;border:1px solid #dc2626;background:#fff;color:#dc2626;border-radius:.5rem;font-weight:600">Delete my account</button>
</div>`,
  );
}
