// Error-Contract Sample
//
// Shows: how a feature raises each Kumiko error class in the places a real
// handler would — pre-flight checks, business-rule violations, stale writes,
// access guards. Every pattern here is copy-pasteable into a real feature.
//
// Key idea: the handler only decides *which* Kumiko class fits. The framework
// does the rest — HTTP status, response shape, Zod parsing, cause chain,
// tx rollback. The handler author never has to touch HTTP codes or assemble
// JSON error bodies.

import { buildEntityTable, createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
  defineTransitions,
  guardTransition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ConflictError,
  failNotFound,
  failUnprocessable,
  NotFoundError,
  UnprocessableError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";

// --- Feature-local reasons: snake_case, no feature prefix needed since the
//     feature name is already namespaced by defineFeature("orders-lite", ...).
//     The framework convention: one const object per feature that needs its
//     own reason strings. For framework-level reasons (stale_state,
//     invalid_transition, ...) use FrameworkReasons instead.
export const OrdersLiteReasons = {
  alreadyPaid: "already_paid",
  alreadyCancelled: "already_cancelled",
  emptyCart: "cart_is_empty",
} as const;

// --- Entity with a state machine so we can show guardTransition + version
//     conflicts. Prices in cents (integer minor unit — see money-type.md).

const ORDER_STATES = ["draft", "placed", "paid", "cancelled"] as const;
type OrderState = (typeof ORDER_STATES)[number];

const ORDER_TRANSITIONS = defineTransitions({
  draft: ["placed", "cancelled"],
  placed: ["paid", "cancelled"],
  paid: [],
  cancelled: [],
});

export const orderEntity = createEntity({
  table: "read_errctr_orders",
  fields: {
    ownerId: createTextField({ required: true }),
    status: createSelectField({ options: ORDER_STATES, default: "draft" }),
    totalCents: createNumberField({ default: 0 }),
  },
  transitions: {
    status: {
      draft: ["placed", "cancelled"],
      placed: ["paid", "cancelled"],
      paid: [],
      cancelled: [],
    },
  },
});

const orderTable = buildEntityTable("order", orderEntity);

export const ordersLiteFeature = defineFeature("orders-lite", (r) => {
  r.entity("order", orderEntity);

  // 1) Create — standard path. Zod schema rejects an empty cart; the
  //    dispatcher converts the ZodIssue into a ValidationError with
  //    details.fields[] (no handler code needed).
  r.writeHandler(
    "order:create",
    z.object({
      totalCents: z.number().int().min(1, "cart_is_empty"),
    }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(orderTable, orderEntity, { entityName: "order" });
      return crud.create(
        { ...event.payload, ownerId: event.user.id, status: "draft" },
        event.user,
        ctx.db,
      );
    },
    { access: { roles: ["User", "Admin"] } },
  );

  // 2) Pay — business rule: only placed orders can be paid. Shows three
  //    different failure shapes in a single handler:
  //      - NotFoundError (order doesn't exist)
  //      - AccessDeniedError (someone else's order, distinct from not_found
  //        so the caller knows it's a permissions issue)
  //      - UnprocessableError with reason from OrdersLiteReasons
  //      - Framework-generated UnprocessableError with reason
  //        FrameworkReasons.invalidTransition via guardTransition
  r.writeHandler(
    "order:pay",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      const [current] = await ctx.db.selectMany(orderTable, { id: event.payload.id });

      // NotFoundError — automatic reason = "order_not_found" via snake-case
      // derivation of the entity name.
      if (!current) return failNotFound("order", event.payload.id);

      const data = current as Record<string, unknown>;

      // AccessDeniedError — intentional info-leak-prevention. We *could*
      // return NotFoundError here too, but splitting the two lets the
      // admin UI distinguish "doesn't exist" from "exists but foreign".
      if (data["ownerId"] !== event.user.id && !event.user.roles.includes("Admin")) {
        return writeFailure(
          new AccessDeniedError({
            message: "order is not yours",
            i18nKey: "orders-lite.errors.notYours",
            details: { reason: "not_yours", orderId: event.payload.id },
          }),
        );
      }

      // UnprocessableError with feature reason — "this order is already in
      // the terminal paid state". Uses the OrdersLiteReasons const so the
      // literal string lives in one place.
      if (data["status"] === "paid") {
        return failUnprocessable(OrdersLiteReasons.alreadyPaid, {
          orderId: event.payload.id,
        });
      }

      // guardTransition throws UnprocessableError with
      // reason = FrameworkReasons.invalidTransition. Callers can branch on
      // that framework-level reason uniformly across entities.
      guardTransition(ORDER_TRANSITIONS, data["status"] as OrderState, "paid");

      const crud = createEventStoreExecutor(orderTable, orderEntity, { entityName: "order" });
      return crud.update(
        {
          id: event.payload.id,
          changes: { status: "paid" },
          version: data["version"] as number,
        },
        event.user,
        ctx.db,
      );
    },
    { access: { roles: ["User", "Admin"] } },
  );

  // 3) Cancel — shows ConflictError for a business conflict that isn't a
  //    transition or a stale write. E.g. a refund window expired; the row
  //    is fine but the action is no longer allowed.
  r.writeHandler(
    "order:cancel",
    z.object({ id: z.uuid() }),
    async (event, ctx) => {
      const [current] = await ctx.db.selectMany(orderTable, { id: event.payload.id });
      if (!current) return failNotFound("order", event.payload.id);

      const data = current as Record<string, unknown>;

      if (data["status"] === "cancelled") {
        return failUnprocessable(OrdersLiteReasons.alreadyCancelled);
      }
      if (data["status"] === "paid") {
        return writeFailure(
          new ConflictError({
            message: "paid orders cannot be cancelled — issue a refund instead",
            i18nKey: "orders-lite.errors.cannotCancelPaid",
            details: { reason: "refund_required", orderId: event.payload.id },
          }),
        );
      }

      const crud = createEventStoreExecutor(orderTable, orderEntity, { entityName: "order" });
      return crud.update(
        {
          id: event.payload.id,
          changes: { status: "cancelled" },
          version: data["version"] as number,
        },
        event.user,
        ctx.db,
      );
    },
    { access: { roles: ["User", "Admin"] } },
  );

  // 4) Update — demonstrates the throw-based path (KumikoError raised
  //    directly, not via writeFailure return). The dispatcher catches it
  //    and wraps it in a WriteErrorInfo the same as the return path.
  //    Use this style when a helper deep in the call tree needs to abort
  //    without threading a WriteResult back up.
  r.writeHandler(
    "order:rename",
    z.object({ id: z.uuid(), nickname: z.string().min(1) }),
    async (event, ctx) => {
      const [current] = await ctx.db.selectMany(orderTable, { id: event.payload.id });

      if (!current) {
        // Throwing a KumikoError is equivalent to `return writeFailure(...)`
        // — both land on the same wire format. Prefer throws from deeper
        // helper functions, writeFailure from the handler's top level.
        throw new NotFoundError("order", event.payload.id);
      }
      if (event.payload.nickname === "banned") {
        throw new UnprocessableError("nickname_not_allowed", {
          i18nKey: "orders-lite.errors.bannedNickname",
        });
      }

      // No real rename yet — the entity has no nickname column. Return a
      // synthetic save context so the handler stays well-typed.
      return {
        isSuccess: true,
        data: {
          kind: "save",
          id: event.payload.id,
          data: current as Record<string, unknown>,
          changes: event.payload,
          previous: current as Record<string, unknown>,
          isNew: false,
          entityName: "order",
        },
      };
    },
    { access: { roles: ["User", "Admin"] } },
  );
});
