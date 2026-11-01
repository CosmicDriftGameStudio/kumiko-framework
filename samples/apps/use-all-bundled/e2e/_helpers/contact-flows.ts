// Docs screenshot flows of the contact feature: the inbox with open, answered and done requests,
// one request with its reply and an internal note, the forwarding settings and the report form.
// Every flow seeds its own requests through the real handlers and the website client, so the
// scenarios stay independent across Playwright workers.

import type {
  ContactWebsiteSubmitFields,
  ContactWebsiteWindow,
} from "@cosmicdrift/kumiko-bundled-features/contact/client";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import {
  CLIENT_IP_HEADER,
  CSRF_COOKIE_NAME,
  type ScenarioFixtures,
} from "@cosmicdrift/kumiko-testing/e2e";
import { expect, type Page } from "@playwright/test";
import { loginAsAdmin } from "./login";

const DETAIL_SUBJECT = "Monitor for api.northwind-freight.example shows 0 % since yesterday";
const DETAIL_MESSAGE =
  "Since 18:20 yesterday the monitor reports an outage, but the API answers normally (curl from Frankfurt and London: 200 in 140 ms). Our subscribers have already received two incident emails.";
const DETAIL_REPLY =
  "Hi Emma, the monitor uses a 1 s timeout and your API has needed up to 1.4 s since yesterday's deploy. Set the timeout to 5 s under Uptime monitors and the monitor turns green within a minute. We will remove the two incident emails from the history.";
const DETAIL_NOTE =
  "Northwind deployed at 18:05 yesterday according to Emma. If the timeout does not help, check the London probe.";

const MAINTENANCE_SUBJECT = "Can a maintenance window repeat on the first Tuesday of every month?";
const EXPORT_SUBJECT = "CSV export of the incident history";
const BANNER_SUBJECT = "Incident banner covers the logo on small phones";

// Public documentation addresses (TEST-NET-3), one per website visitor: the submit limit counts per IP.
const WEBSITE_VISITORS = [
  {
    clientIp: "203.0.113.151",
    fields: {
      kind: "question",
      name: "Sophie Turner",
      email: "sophie@turner-consulting.example",
      message:
        "Can we run the status page under status.turner-consulting.com while our DNS stays with another provider?",
      locale: "en",
    },
    outcome: "open",
  },
  {
    clientIp: "203.0.113.152",
    fields: {
      kind: "contact",
      name: "Michael Brooks",
      email: "m.brooks@lakeside-utilities.example",
      message: "We are a municipal utility and need a quote for 40 components with our own domain.",
      locale: "en",
    },
    outcome: "answered",
  },
  {
    clientIp: "203.0.113.153",
    fields: {
      kind: "question",
      name: "Priya Shah",
      email: "priya@shah-studio.example",
      message: "Do subscribers get a text message as well, or only an email?",
      locale: "en",
    },
    outcome: "done",
  },
] as const satisfies readonly {
  readonly clientIp: string;
  readonly fields: ContactWebsiteSubmitFields;
  readonly outcome: "open" | "answered" | "done";
}[];

const QUOTE_REPLY =
  "Hi Michael, 40 components with your own domain fit the Business plan. I have sent the order form and the DNS steps to this address.";

type ContactRequestRow = { readonly id: string; readonly name: string };

async function csrfHeader(page: Page): Promise<Record<string, string>> {
  const csrf = (await page.context().cookies()).find((c) => c.name === CSRF_COOKIE_NAME)?.value;
  if (!csrf) throw new Error(`no ${CSRF_COOKIE_NAME} cookie after login`);
  return { "X-CSRF-Token": csrf };
}

async function writeAsPage(page: Page, type: string, payload: unknown): Promise<void> {
  const res = await page.request.post("/api/write", {
    headers: await csrfHeader(page),
    data: { type, payload },
  });
  if (!res.ok()) throw new Error(`${type} → ${res.status()} ${await res.text()}`);
}

async function requestRowsAsPage(page: Page): Promise<readonly ContactRequestRow[]> {
  const res = await page.request.post("/api/query", {
    headers: await csrfHeader(page),
    data: { type: "contact:query:contact-request:list", payload: { limit: 100 } },
  });
  if (!res.ok()) throw new Error(`contact request list → ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { data?: { rows?: readonly ContactRequestRow[] } };
  return body.data?.rows ?? [];
}

async function submitFromWebsite(
  page: Page,
  clientIp: string,
  fields: ContactWebsiteSubmitFields,
): Promise<void> {
  await page.setExtraHTTPHeaders({ [CLIENT_IP_HEADER]: clientIp });
  await page.goto("/");
  await page.addScriptTag({ url: "/contact/client.js" });
  const outcome = await page.evaluate(async (payload) => {
    const client = (window as Window & ContactWebsiteWindow).KumikoContact;
    if (client === undefined) throw new Error("contact client.js did not register KumikoContact");
    return client.submit(payload);
  }, fields);
  await page.setExtraHTTPHeaders({});
  expect(outcome.kind).toBe("sent");
}

export const contactInboxFlow =
  () =>
  async (page: Page, { seedTenant }: ScenarioFixtures) => {
    const harbor = await seedTenant({
      name: "Harbor Analytics",
      admin: { displayName: "Daniel Price", email: "daniel.price@harbor-analytics.example" },
    });
    const brightline = await seedTenant({
      name: "Brightline Media",
      admin: { displayName: "Lena Fischer", email: "lena.fischer@brightline-media.example" },
    });
    const maintenance = await harbor.api.writeOk<{ id: string }>("contact:write:report", {
      kind: "question",
      subject: MAINTENANCE_SUBJECT,
      message:
        "We patch our database cluster on the first Tuesday of each month from 22:00 to 23:00. Creating the window by hand every month is easy to forget.",
    });
    await harbor.api.writeOk("contact:write:report", {
      kind: "wish",
      subject: EXPORT_SUBJECT,
      message:
        "For our quarterly SLA report we copy every incident by hand. A CSV export per component would save us an afternoon each quarter.",
    });
    await brightline.api.writeOk("contact:write:report", {
      kind: "bug",
      phone: "+49 30 2093 4471",
      subject: BANNER_SUBJECT,
      message:
        "On an iPhone SE the red incident banner sits on top of our logo and hides the first line of the incident text.",
    });
    for (const visitor of WEBSITE_VISITORS) {
      await submitFromWebsite(page, visitor.clientIp, visitor.fields);
    }

    await loginAsAdmin(page);
    await writeAsPage(page, "contact:write:mark-done", { id: maintenance.id });
    const rows = await requestRowsAsPage(page);
    for (const visitor of WEBSITE_VISITORS) {
      if (visitor.outcome === "open") continue;
      const row = rows.find((candidate) => candidate.name === visitor.fields.name);
      if (row === undefined) throw new Error(`no request from ${visitor.fields.name}`);
      if (visitor.outcome === "done") {
        await writeAsPage(page, "contact:write:mark-done", { id: row.id });
      } else {
        await writeAsPage(page, "contact:write:reply", { requestId: row.id, message: QUOTE_REPLY });
      }
    }

    await page.goto("/platform/request-list");
    await page.getByRole("button", { name: /^All\s*\d+$/ }).click();
    await expect(page.getByText(MAINTENANCE_SUBJECT)).toBeVisible();
    await expect(page.getByText(BANNER_SUBJECT)).toBeVisible();
    await expect(page.getByText("Michael Brooks")).toBeVisible();
  };

export const contactDetailFlow =
  () =>
  async (page: Page, { seedTenant }: ScenarioFixtures) => {
    const northwind = await seedTenant({
      name: "Northwind Freight",
      admin: { displayName: "Emma Clarke", email: "emma.clarke@northwind-freight.example" },
    });
    // The request keeps the plan the tenant had when it reported.
    await loginAsAdmin(page);
    await writeAsPage(page, "tier-engine:write:set-tenant-tier", {
      tenantId: northwind.id,
      tier: "pro",
    });
    const reported = await northwind.api.writeOk<{ id: string }>("contact:write:report", {
      kind: "bug",
      phone: "+44 20 7946 0321",
      subject: DETAIL_SUBJECT,
      message: DETAIL_MESSAGE,
    });
    // Notes are stored in the tenant of the writer's session; the dev tenant carries the note
    // count the cap overview shows, so the operator works from a tenant of their own.
    const operations = await seedTenant({ name: "Status Page Operations" });
    const operator = await operations.addUser([ROLES.SystemAdmin], {
      displayName: "Hannah Weber",
      email: "hannah.weber@status-operations.example",
    });
    await operations
      .apiAs(operator)
      .writeOk("contact:write:reply", { requestId: reported.id, message: DETAIL_REPLY });
    await operations.loginAs(page, operator);
    await page.goto(`/platform/request-detail/${reported.id}`);
    await expect(page.getByText(DETAIL_REPLY).first()).toBeVisible();
    await page.locator("#notes-section-draft").fill(DETAIL_NOTE);
    await page.getByTestId("notes-section-add").click();
    await expect(page.getByText(DETAIL_NOTE)).toBeVisible();
    await expect(page.getByRole("link", { name: "+44 20 7946 0321" })).toBeVisible();
    // Adding the note scrolls the page to the bottom; the shot starts at the request and its reply.
    await page.getByText(DETAIL_MESSAGE).scrollIntoViewIfNeeded();
  };

// Shows the settings without saving them: the reply-to address is a system-wide value that
// contact.screenshots.spec.ts saves and asserts in the same run, and an empty field is the
// documented default (replies go out with the address of the replying SystemAdmin).
export const contactForwardingFlow = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/platform");
  await page.getByRole("link", { name: "Forwarding", exact: true }).click();
  await expect(page.getByLabel("Reply-To address")).toBeEditable();
  await expect(page.getByText("No unsaved changes")).toBeVisible();
};

export const contactReportFlow = () => async (page: Page) => {
  await loginAsAdmin(page);
  await page.goto("/tenant-admin/report");
  await expect(page.getByText("Goes straight to the publicstatus team")).toBeVisible();
  await page.getByText("Bug", { exact: true }).click();
  await page.getByLabel("Phone").fill("+49 40 609 412 77");
  await page.getByLabel("Subject").fill("Subscriber emails link to the old status page domain");
  await page
    .getByLabel("What happened?")
    .fill(
      "Since we moved the status page to status.acme-cloud.example, the incident emails still link to the old acme-cloud.publicstatus.eu address. Subscribers end up on a page without the current incident.",
    );
};
