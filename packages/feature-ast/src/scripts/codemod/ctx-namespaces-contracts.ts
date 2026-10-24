import type { CallExpression, NewExpression, Node, PropertyAccessExpression, Type } from "ts-morph";
import { Node as MorphNode } from "ts-morph";
import { appContextReference, type Counters } from "./ctx-namespaces-annotations.ts";
import { receiverOf } from "./ctx-namespaces-detect.ts";
import type { EditPlan } from "./ctx-namespaces-edits.ts";
import { isContextMemberName, isMovedMemberName } from "./ctx-namespaces-mapping.ts";

const REMOVED_FROM_HANDLER: ReadonlyMap<string, string> = new Map([
  ["systemUser", "systemUser: removed from HandlerContext"],
  ["triggeredBy", "triggeredBy: removed from HandlerContext"],
  ["_tenantId", "_tenantId: removed from HandlerContext, read ctx.user.tenantId"],
]);

// Boot wiring that an app read off the flat context through a cast; the context no longer carries it.
const WIRING_ONLY_MEMBERS: ReadonlySet<string> = new Set([
  "configAccessorFactory",
  "geoTzProvider",
  "clock",
  "defaultLocale",
  "_rateLimitPayloadDigest",
  "triggerName",
]);

export function contextReceiver(counters: Counters, expression: Node, memberName?: string) {
  return receiverOf(expression.getType(), memberName, counters.pinnedKindOf(expression));
}

export function planRemovedMember(
  plan: EditPlan,
  counters: Counters,
  access: PropertyAccessExpression,
): boolean {
  const reason = REMOVED_FROM_HANDLER.get(access.getName());
  if (reason === undefined) return false;
  const receiver = contextReceiver(counters, access.getExpression(), access.getName());
  if (receiver.kind !== "context" || !receiver.contexts.includes("handler")) return false;
  plan.flagManual(access, reason);
  return true;
}

function castBase(access: PropertyAccessExpression): Node | undefined {
  let current: Node = access.getExpression();
  let sawCast = false;
  while (MorphNode.isParenthesizedExpression(current) || MorphNode.isAsExpression(current)) {
    sawCast ||= MorphNode.isAsExpression(current);
    current = current.getExpression();
  }
  return sawCast ? current : undefined;
}

function isContextProperty(type: Type, memberName: string): boolean {
  return type.getNonNullableType().getApparentType().getProperty(memberName) !== undefined;
}

// extraContext keys used to sit flat on the context, where a cast could read them; they now live
// in services.extensions.
export function planCastedMember(
  plan: EditPlan,
  counters: Counters,
  access: PropertyAccessExpression,
): boolean {
  const base = castBase(access);
  const memberName = access.getName();
  if (base === undefined || isMovedMemberName(memberName)) return false;
  if (isContextMemberName(memberName)) return false;
  if (REMOVED_FROM_HANDLER.has(memberName)) return false;
  if (contextReceiver(counters, base).kind !== "context") return false;
  if (isContextProperty(base.getType(), memberName)) return false;
  if (WIRING_ONLY_MEMBERS.has(memberName)) {
    plan.flagManual(access, `${memberName}: boot wiring is no longer exposed on the context`);
    return false;
  }
  plan.replaceNode(base, `${base.getText()}.services.extensions`);
  plan.recordRewrite(access, `${memberName} read through a cast -> services.extensions`);
  return true;
}

export function planAppContextArguments(
  plan: EditPlan,
  counters: Counters,
  call: CallExpression | NewExpression,
): boolean {
  const target = call.getExpression().getType();
  const signature = (
    MorphNode.isNewExpression(call) ? target.getConstructSignatures() : target.getCallSignatures()
  )[0];
  if (signature === undefined) return false;
  let flagged = false;
  call.getArguments().forEach((argument, index) => {
    const declaration = signature.getParameters()[index]?.getDeclarations()[0];
    const annotation = MorphNode.isParameterDeclaration(declaration)
      ? declaration.getTypeNode()
      : undefined;
    // skip: only AppContext parameters fed a handler or job context are a finding
    if (appContextReference(annotation) === undefined) return;
    // skip: the argument is not a Kumiko context
    if (contextReceiver(counters, argument).kind !== "context") return;
    plan.flagManual(argument, "a handler or job context is passed to an AppContext parameter");
    flagged = true;
  });
  return flagged;
}
