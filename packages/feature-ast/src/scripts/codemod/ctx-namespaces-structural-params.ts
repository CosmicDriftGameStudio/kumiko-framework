import {
  type CallExpression,
  Node as MorphNode,
  type NewExpression,
  type Type,
  ts,
} from "ts-morph";
import { appContextReference, type Counters } from "./ctx-namespaces-annotations.ts";
import { contextReceiver } from "./ctx-namespaces-contracts.ts";
import type { EditPlan } from "./ctx-namespaces-edits.ts";
import { flatMemberTarget } from "./ctx-namespaces-mapping.ts";

// A structural parameter that declares a moved member as optional type-checks against the new
// context and silently reads undefined at runtime; tsc cannot see it.
function optionalMovedMembers(parameterType: Type, argumentType: Type): string[] {
  const argument = argumentType.getNonNullableType().getApparentType();
  return parameterType
    .getNonNullableType()
    .getProperties()
    .filter(
      (property) =>
        property.hasFlags(ts.SymbolFlags.Optional) &&
        flatMemberTarget(property.getName()) !== undefined &&
        argument.getProperty(property.getName()) === undefined,
    )
    .map((property) => property.getName());
}

export function planStructuralArguments(
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
    const parameter = signature.getParameters()[index];
    // skip: a rest or extra argument has no declared parameter type to check
    if (parameter === undefined) return;
    const declaration = parameter.getDeclarations()[0];
    const annotation = MorphNode.isParameterDeclaration(declaration)
      ? declaration.getTypeNode()
      : undefined;
    // skip: AppContext parameters are reported by planAppContextArguments
    if (appContextReference(annotation) !== undefined) return;
    // skip: only Kumiko handler or job contexts lost flat members
    if (contextReceiver(counters, argument).kind !== "context") return;
    const names = optionalMovedMembers(parameter.getTypeAtLocation(call), argument.getType());
    for (const name of names) {
      plan.flagManual(
        argument,
        `a handler or job context is passed to a parameter that reads ${name}, which moved to ${flatMemberTarget(name)}`,
      );
      flagged = true;
    }
  });
  return flagged;
}
