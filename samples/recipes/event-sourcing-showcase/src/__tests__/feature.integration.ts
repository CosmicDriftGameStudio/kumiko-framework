// Event Sourcing Showcase — Integration Test
//
// Exercises every Sprint-E Marten gold-standard API end-to-end:
//   - r.defineEvent with version + r.eventMigration (sync + async upcaster)
//   - ctx.appendEvent onto the aggregate stream (incl. headers metadata)
//   - r.projection (single-stream, inline)
//   - r.multiStreamProjection (async)
//   - ctx.loadAggregate with { asOf }
//   - ctx.archiveStream
//   - ctx.queryProjection
//   - streamAllEventsByType (memory-bounded ops iteration)
//   - getAllProjectionProgress (projection lag for ops dashboards)

import {
  append,
  loadAggregate as loadAggregateRaw,
  makeUpcastCtx,
  streamAllEventsByType,
  upcastStoredEvent,
} from "@kumiko/framework/event-store";
import { getAllProjectionProgress } from "@kumiko/framework/pipeline";
import {
  createEntityTable,
  createTestUser,
  pushTables,
  resetEventStore,
  setupTestStack,
  type TestStack,
} from "@kumiko/framework/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  approverDirectoryTable,
  invoiceDetailTable,
  invoiceEntity,
  invoiceFeature,
} from "../feature";

let stack: TestStack;
const admin = createTestUser({ roles: ["Admin"] });

beforeAll(async () => {
  stack = await setupTestStack({ features: [invoiceFeature], systemHooks: [] });
  await createEntityTable(stack.db, invoiceEntity, "showcase-invoice");
  await pushTables(stack.db, { read_showcase_approver_directory: approverDirectoryTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetEventStore(stack, [
    "read_showcase_invoices",
    "read_showcase_invoice_detail",
    "read_showcase_customer_revenue",
    "read_showcase_approver_directory",
  ]);
  // Reset Redis namespace too — invoice:pay declares a per-user
  // rate limit, so leftover bucket state from a previous test would
  // throttle the next test's pay-calls.
  await stack.redis.flushNamespace();
  await stack.eventDispatcher?.ensureRegistered();
});

describe("Event Sourcing Showcase", () => {
  test("create → approve → pay: inline projection reflects each step", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "Acme" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id, amountCents: 2500, approvedBy: "cfo" },
      admin,
    );
    await stack.http.writeOk("showcase:write:invoice:pay", { id, amountCents: 2500 }, admin);

    const [row] = await stack.db
      .select()
      .from(invoiceDetailTable)
      .where(eq(invoiceDetailTable.invoiceId, id));
    expect(row).toMatchObject({
      customer: "Acme",
      status: "paid",
      amountCents: 2500,
    });
  });

  test("async MSP: customer-revenue accumulates across paid invoices", async () => {
    const inv1 = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "Acme" },
      admin,
    );
    const inv2 = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "Acme" },
      admin,
    );
    const inv3 = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "Globex" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id: inv1.id, amountCents: 1000, approvedBy: "a" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:pay",
      { id: inv1.id, amountCents: 1000 },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id: inv2.id, amountCents: 500, approvedBy: "a" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:pay",
      { id: inv2.id, amountCents: 500 },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id: inv3.id, amountCents: 300, approvedBy: "a" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:pay",
      { id: inv3.id, amountCents: 300 },
      admin,
    );

    await stack.eventDispatcher?.runOnce();

    const revenue = await stack.http.queryOk<
      Array<{ customer: string; paidInvoices: number; totalCents: number }>
    >("showcase:query:revenue:list", {}, admin);

    const byCustomer = new Map(revenue.map((r) => [r.customer, r]));
    expect(byCustomer.get("Acme")).toMatchObject({ paidInvoices: 2, totalCents: 1500 });
    expect(byCustomer.get("Globex")).toMatchObject({ paidInvoices: 1, totalCents: 300 });
  });

  test("asOf point-in-time read: invoice state before the pay event", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "TimeTraveler" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id, amountCents: 900, approvedBy: "cfo" },
      admin,
    );
    const cutoff = new Date();
    await new Promise((r) => setTimeout(r, 10));
    await stack.http.writeOk("showcase:write:invoice:pay", { id, amountCents: 900 }, admin);

    const now = await stack.http.queryOk<{ status: string; paid: boolean }>(
      "showcase:query:invoice:state",
      { id },
      admin,
    );
    expect(now.status).toBe("paid");
    expect(now.paid).toBe(true);

    const past = await stack.http.queryOk<{ status: string; paid: boolean }>(
      "showcase:query:invoice:state",
      { id, asOf: cutoff.toISOString() },
      admin,
    );
    expect(past.status).toBe("approved");
    expect(past.paid).toBe(false);
  });

  test("upcaster: v1 approved event on disk reaches the reducer as v2", async () => {
    // Simulate a pre-migration event shape by appending directly at
    // eventVersion=1. This is what stored v1 approval events look like
    // on disk today — the upcaster walks them to v2 on read.
    const invoiceId = "00000000-0000-4000-8000-00000000f001";
    await stack.db.transaction(async (tx) => {
      await tx.insert(invoiceDetailTable).values({
        invoiceId,
        tenantId: admin.tenantId,
        customer: "Legacy Co",
        status: "draft",
        amountCents: 0,
      });
      await append(tx, {
        aggregateId: invoiceId,
        aggregateType: "showcase-invoice",
        tenantId: admin.tenantId,
        expectedVersion: 0,
        type: "showcase-invoice.created",
        payload: { id: invoiceId, customer: "Legacy Co", status: "draft" },
        metadata: { userId: admin.id },
      });
      await append(tx, {
        aggregateId: invoiceId,
        aggregateType: "showcase-invoice",
        tenantId: admin.tenantId,
        expectedVersion: 1,
        type: "showcase:event:invoice-approved",
        eventVersion: 1,
        payload: { amount: "15.50", approvedBy: "legacy-cfo" },
        metadata: { userId: admin.id },
      });
    });

    const state = await stack.http.queryOk<{
      status: string;
      amountCents: number;
      approvedBy: string | null;
    }>("showcase:query:invoice:state", { id: invoiceId }, admin);

    // v1 payload { amount: "15.50" } upcasts to v2 { amountCents: 1550 }
    expect(state.status).toBe("approved");
    expect(state.amountCents).toBe(1550);
    expect(state.approvedBy).toBe("legacy-cfo");

    // On-disk row is untouched — upcaster is read-time only.
    const raw = await loadAggregateRaw(stack.db, invoiceId, admin.tenantId);
    const rawApproved = raw.find((e) => e.type === "showcase:event:invoice-approved");
    expect(rawApproved?.eventVersion).toBe(1);
    expect(rawApproved?.payload).toEqual({ amount: "15.50", approvedBy: "legacy-cfo" });
  });

  test("archiveStream: loadAggregate returns empty after archive, ops bypass surfaces events", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "ArchivePal" },
      admin,
    );
    await stack.http.writeOk("showcase:write:invoice:archive", { id }, admin);

    const state = await stack.http.queryOk<{ status: string }>(
      "showcase:query:invoice:state",
      { id },
      admin,
    );
    expect(state.status).toBe("missing"); // loadAggregate returned [] → reducer starts clean

    const raw = await loadAggregateRaw(stack.db, id, admin.tenantId, {
      includeArchived: true,
    });
    expect(raw.length).toBeGreaterThan(0); // events are still on disk for ops
  });

  test("snapshot: fast-state uses the snapshot + upcaster-wrapped delta replay", async () => {
    // Seed a full invoice lifecycle so there are three events on the
    // stream (created, approved, paid).
    const { id } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "Snapco" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id, amountCents: 3300, approvedBy: "cfo" },
      admin,
    );
    await stack.http.writeOk("showcase:write:invoice:pay", { id, amountCents: 3300 }, admin);

    // Without a snapshot: fast-state still returns the correct state
    // (falls back to full replay, snapshotHit=false).
    const beforeSnapshot = await stack.http.queryOk<{
      state: { status: string; amountCents: number };
      version: number;
      snapshotHit: boolean;
    }>("showcase:query:invoice:fast-state", { id }, admin);
    expect(beforeSnapshot.snapshotHit).toBe(false);
    expect(beforeSnapshot.state.status).toBe("paid");
    expect(beforeSnapshot.state.amountCents).toBe(3300);

    // Take a snapshot after the pay event. ctx.snapshotAggregate writes
    // kumiko_snapshots with the committed state + version.
    const snapResult = await stack.http.writeOk<{ id: string; snapshotVersion: number }>(
      "showcase:write:invoice:take-snapshot",
      { id },
      admin,
    );
    expect(snapResult.snapshotVersion).toBe(3);

    // After the snapshot: fast-state sees the cache (snapshotHit=true) and
    // no delta events beyond it. Same final state.
    const afterSnapshot = await stack.http.queryOk<{
      state: { status: string; amountCents: number };
      version: number;
      snapshotHit: boolean;
    }>("showcase:query:invoice:fast-state", { id }, admin);
    expect(afterSnapshot.snapshotHit).toBe(true);
    expect(afterSnapshot.state.status).toBe("paid");
    expect(afterSnapshot.state.amountCents).toBe(3300);
  });

  test("snapshot: upcaster runs on delta events past the snapshot", async () => {
    // Seed only v1-shaped events directly to prove upcasting walks delta.
    const invoiceId = "00000000-0000-4000-8000-00000000f002";
    await stack.db.transaction(async (tx) => {
      await tx.insert(invoiceDetailTable).values({
        invoiceId,
        tenantId: admin.tenantId,
        customer: "Upcast Co",
        status: "draft",
        amountCents: 0,
      });
      await append(tx, {
        aggregateId: invoiceId,
        aggregateType: "showcase-invoice",
        tenantId: admin.tenantId,
        expectedVersion: 0,
        type: "showcase-invoice.created",
        payload: { id: invoiceId, customer: "Upcast Co", status: "draft" },
        metadata: { userId: admin.id },
      });
    });

    // Snapshot the "just-created" state at v1 — before any v1-shaped
    // approval event lands on the stream.
    await stack.http.writeOk("showcase:write:invoice:take-snapshot", { id: invoiceId }, admin);

    // Now append a v1-shape approval event (raw) — this becomes a delta
    // past the snapshot. fast-state must upcast it before the reducer.
    await stack.db.transaction(async (tx) => {
      await append(tx, {
        aggregateId: invoiceId,
        aggregateType: "showcase-invoice",
        tenantId: admin.tenantId,
        expectedVersion: 1,
        type: "showcase:event:invoice-approved",
        eventVersion: 1,
        payload: { amount: "27.50", approvedBy: "legacy-cfo" },
        metadata: { userId: admin.id },
      });
    });

    const state = await stack.http.queryOk<{
      state: { status: string; amountCents: number; approvedBy: string | null };
      snapshotHit: boolean;
    }>("showcase:query:invoice:fast-state", { id: invoiceId }, admin);

    expect(state.snapshotHit).toBe(true);
    expect(state.state.status).toBe("approved");
    // v1 { amount: "27.50" } upcasted → v2 { amountCents: 2750 }
    expect(state.state.amountCents).toBe(2750);
    expect(state.state.approvedBy).toBe("legacy-cfo");
  });

  test("tenant isolation: queryProjection auto-filters by tenant_id", async () => {
    const otherAdmin = createTestUser({
      id: 99,
      roles: ["Admin"],
      tenantId: "00000000-0000-4000-8000-000000000042",
    });

    const mine = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "Mine" },
      admin,
    );
    const theirs = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "Theirs" },
      otherAdmin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id: mine.id, amountCents: 100, approvedBy: "a" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:pay",
      { id: mine.id, amountCents: 100 },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id: theirs.id, amountCents: 200, approvedBy: "b" },
      otherAdmin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:pay",
      { id: theirs.id, amountCents: 200 },
      otherAdmin,
    );
    await stack.eventDispatcher?.runOnce();

    const adminView = await stack.http.queryOk<Array<{ customer: string; totalCents: number }>>(
      "showcase:query:revenue:list",
      {},
      admin,
    );
    expect(adminView.map((r) => r.customer)).toEqual(["Mine"]);
    expect(adminView[0]?.totalCents).toBe(100);

    const otherView = await stack.http.queryOk<Array<{ customer: string; totalCents: number }>>(
      "showcase:query:revenue:list",
      {},
      otherAdmin,
    );
    expect(otherView.map((r) => r.customer)).toEqual(["Theirs"]);
    expect(otherView[0]?.totalCents).toBe(200);
  });

  test("ctx.appendEvent with headers: Marten free key/value metadata lands in stored event", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "MetaCo" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id, amountCents: 700, approvedBy: "cfo", geoRegion: "EU", abTestBucket: "B" },
      admin,
    );

    const events = await loadAggregateRaw(stack.db, id, admin.tenantId);
    const approved = events.find((e) => e.type === "showcase:event:invoice-approved");
    expect(approved?.metadata.headers).toEqual({ geoRegion: "EU", abTestBucket: "B" });

    // Headers stay opt-in: omitting them keeps the field absent (no empty
    // object surface). Verifies we don't pollute every event with a {}.
    const { id: bareId } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "BareCo" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id: bareId, amountCents: 100, approvedBy: "cfo" },
      admin,
    );
    const bareEvents = await loadAggregateRaw(stack.db, bareId, admin.tenantId);
    const bareApproved = bareEvents.find((e) => e.type === "showcase:event:invoice-approved");
    expect(bareApproved?.metadata.headers).toBeUndefined();
  });

  test("async upcaster: invoice-acknowledged v1 enriches via directory DB lookup at read time", async () => {
    // Seed the directory so the async upcaster can find a name.
    await stack.db.insert(approverDirectoryTable).values({
      approverId: "u-42",
      displayName: "Quincy Acknowledger",
    });

    // Append a v1 acknowledged event directly to simulate a pre-migration
    // payload on disk. ctx.appendEvent always writes the current version,
    // so the only way to test the read-time upcaster is to write the older
    // shape via the raw event-store.
    const invoiceId = "00000000-0000-4000-8000-00000000ac01";
    await stack.db.transaction(async (tx) => {
      await tx.insert(invoiceDetailTable).values({
        invoiceId,
        tenantId: admin.tenantId,
        customer: "AckCo",
        status: "draft",
        amountCents: 0,
      });
      await append(tx, {
        aggregateId: invoiceId,
        aggregateType: "showcase-invoice",
        tenantId: admin.tenantId,
        expectedVersion: 0,
        type: "showcase-invoice.created",
        payload: { id: invoiceId, customer: "AckCo", status: "draft" },
        metadata: { userId: admin.id },
      });
      await append(tx, {
        aggregateId: invoiceId,
        aggregateType: "showcase-invoice",
        tenantId: admin.tenantId,
        expectedVersion: 1,
        type: "showcase:event:invoice-acknowledged",
        eventVersion: 1,
        payload: { approverId: "u-42" },
        metadata: { userId: admin.id },
      });
    });

    // Raw on-disk row keeps the v1 shape — upcasters never rewrite history.
    const rawEvents = await loadAggregateRaw(stack.db, invoiceId, admin.tenantId);
    const rawAck = rawEvents.find((e) => e.type === "showcase:event:invoice-acknowledged");
    expect(rawAck?.eventVersion).toBe(1);
    expect(rawAck?.payload).toEqual({ approverId: "u-42" });

    // The actual proof: run the v1 row through the upcaster chain and
    // verify the async DB lookup populated approverDisplayName. This is
    // exactly what dispatcher.loadAggregate / projection-rebuild do
    // internally — calling the primitive directly here lets the sample
    // assert the read-path enrichment without an extra wrapper handler.
    if (!rawAck) throw new Error("seed failed");
    const enriched = await upcastStoredEvent(
      rawAck,
      stack.registry.getEventUpcasters(),
      makeUpcastCtx(stack.db, admin.tenantId),
    );
    expect(enriched.eventVersion).toBe(2);
    expect(enriched.payload).toMatchObject({
      approverId: "u-42",
      approverDisplayName: "Quincy Acknowledger",
    });

    // Sanity check the ctx.appendEvent path too: it writes the current
    // shape directly (handler resolved displayName synchronously), so
    // the upcaster is a no-op on these events.
    const { id: liveId } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "AckCo2" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:acknowledge",
      { id: liveId, approverId: "u-42" },
      admin,
    );
    const liveEvents = await loadAggregateRaw(stack.db, liveId, admin.tenantId);
    const liveAck = liveEvents.find((e) => e.type === "showcase:event:invoice-acknowledged");
    expect(liveAck?.eventVersion).toBe(2);
    expect(liveAck?.payload).toMatchObject({
      approverId: "u-42",
      approverDisplayName: "Quincy Acknowledger",
    });
  });

  test("streamAllEventsByType: ops iteration walks all events without buffering", async () => {
    // Seed 25 invoices with create + approve = 50 events across the
    // showcaseInvoice aggregate type.
    for (let i = 0; i < 25; i++) {
      const { id } = await stack.http.writeOk<{ id: string }>(
        "showcase:write:invoice:create",
        { customer: `C${i}` },
        admin,
      );
      await stack.http.writeOk(
        "showcase:write:invoice:approve",
        { id, amountCents: 100 + i, approvedBy: "cfo" },
        admin,
      );
    }

    // batchSize=10 forces 5 batches (10+10+10+10+10) — proves cursor
    // advance across multiple round-trips, not just a single load.
    let count = 0;
    const types = new Set<string>();
    for await (const evt of streamAllEventsByType(stack.db, "showcase-invoice", 10)) {
      count++;
      types.add(evt.type);
    }
    expect(count).toBe(50);
    expect([...types].sort()).toEqual([
      "showcase-invoice.created",
      "showcase:event:invoice-approved",
    ]);
  });

  test("getAllProjectionProgress: HWM advances with the event log", async () => {
    // Inline projections (r.projection) don't track a cursor in
    // kumiko_projections — the row only gets written by ops-rebuild.
    // So getAllProjectionProgress mainly surfaces HWM + the cursor
    // remembered from the last rebuild. Useful as a "is anyone behind?"
    // dashboard once you actually run rebuilds. This test pins the HWM
    // advance and the never-rebuilt baseline so a regression in either
    // surfaces cleanly.
    const before = await getAllProjectionProgress(stack.db, stack.registry);
    const detail = before.find((p) => p.name === "showcase:projection:invoice-detail");
    expect(detail?.status).toBe("never-rebuilt");
    expect(detail?.highWaterMark).toBe(0n);
    expect(detail?.lastProcessedEventId).toBe(0n);
    expect(detail?.lag).toBe(0n);

    const { id } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "LagCheck" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id, amountCents: 200, approvedBy: "cfo" },
      admin,
    );

    const after = await getAllProjectionProgress(stack.db, stack.registry);
    const detailAfter = after.find((p) => p.name === "showcase:projection:invoice-detail");
    expect(detailAfter?.highWaterMark).toBe(2n);
    expect(detailAfter?.lastProcessedEventId).toBe(0n);
    expect(detailAfter?.lag).toBe(2n);
  });

  test("AllConsumerProgress: MSP cursor catches up to HWM after dispatcher run", async () => {
    const { getAllConsumerProgress } = await import("@kumiko/framework/pipeline");
    const consumerName = "showcase:projection:customer-revenue";

    const baseline = await getAllConsumerProgress(stack.db, [consumerName]);
    expect(baseline[0]?.lag).toBe(0n);

    // Drive a full create→approve→pay → 1 event log entry per write,
    // plus the inline projection writes = 3 events on the stream.
    // The MSP only reacts to invoice-paid, but its cursor still has
    // to catch up to the latest events.id to be "current".
    const { id } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "ConsumerLag" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id, amountCents: 400, approvedBy: "cfo" },
      admin,
    );
    await stack.http.writeOk("showcase:write:invoice:pay", { id, amountCents: 400 }, admin);

    // Before runOnce: events on the log, MSP cursor untouched → lag > 0.
    const lagged = await getAllConsumerProgress(stack.db, [consumerName]);
    expect(lagged[0]?.highWaterMark).toBeGreaterThan(0n);
    expect(lagged[0]?.lag).toBe(lagged[0]?.highWaterMark);

    // runOnce drains the dispatcher → cursor advances to HWM → lag = 0.
    await stack.eventDispatcher?.runOnce();
    const caughtUp = await getAllConsumerProgress(stack.db, [consumerName]);
    expect(caughtUp[0]?.lag).toBe(0n);
    expect(caughtUp[0]?.lastProcessedEventId).toBe(caughtUp[0]?.highWaterMark);
  });

  test("ctx.signal: long-running query handler honors abort from HTTP client", async () => {
    // 50 chunks × 10ms = ~500ms total. Abort after ~80ms — handler
    // should observe signal.aborted via throwIfAborted() inside the
    // loop, throw, and the response surfaces an error. Without the
    // signal honour, the handler would run all 500ms regardless.
    const token = await stack.jwt.sign(admin);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 80);

    const start = Date.now();
    let outcome: "completed" | "aborted" | "error-response" = "completed";
    try {
      const res = await stack.app.request(
        new Request("http://test.local/api/query", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: "showcase:query:ops:slow-export",
            payload: { chunks: 50 },
          }),
          signal: controller.signal,
        }),
      );
      // If the server completed before abort landed, status is 200.
      // If the handler observed abort and threw, the dispatcher wraps
      // it as an internal error response.
      if (res.status >= 400) outcome = "error-response";
    } catch (e) {
      // Outer fetch may surface AbortError when abort is observed at
      // the transport layer.
      if (e instanceof Error && e.name === "AbortError") outcome = "aborted";
      else throw e;
    }
    const elapsed = Date.now() - start;

    // Either way, we should be done well before the full 500ms — proves
    // the handler did NOT run all 50 chunks. A handler ignoring signal
    // would always take ≥500ms.
    expect(elapsed).toBeLessThan(400);
    expect(outcome).not.toBe("completed");
  });

  test("rate limit: invoice:pay caps at 5 per user per window, 6th returns 429", async () => {
    // The handler declares `rateLimit: { per: "user", limit: 5, windowSeconds: 60 }`.
    // Five calls within the window go through; the sixth surfaces a
    // 429-shaped error response without running the handler body
    // (and therefore without touching the event store).
    const { id } = await stack.http.writeOk<{ id: string }>(
      "showcase:write:invoice:create",
      { customer: "RateLimited" },
      admin,
    );
    await stack.http.writeOk(
      "showcase:write:invoice:approve",
      { id, amountCents: 100, approvedBy: "cfo" },
      admin,
    );

    for (let i = 0; i < 5; i++) {
      await stack.http.writeOk("showcase:write:invoice:pay", { id, amountCents: 100 }, admin);
    }

    // 6th call hits the cap. queryOk/writeOk would throw on a non-2xx
    // response, hiding the wire body — go through `write` directly so
    // we can assert the 429 + RateLimitError shape.
    const blocked = await stack.http.write(
      "showcase:write:invoice:pay",
      { id, amountCents: 100 },
      admin,
    );
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as {
      error: { code: string; details?: { bucket?: string; limit?: number } };
    };
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.details?.limit).toBe(5);
    expect(body.error.details?.bucket).toBe(`user:${admin.id}`);
  });
});
