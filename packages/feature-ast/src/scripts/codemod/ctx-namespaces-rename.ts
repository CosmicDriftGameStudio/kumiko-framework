import { Node } from "ts-morph";
import type { EditPlan } from "./ctx-namespaces-edits.ts";

const RENAMED_MEMBER = { from: "_configAccessorFactory", to: "configAccessorFactory" };

export function planRenamedMember(plan: EditPlan, node: Node): boolean {
  if (Node.isPropertyAccessExpression(node) && node.getName() === RENAMED_MEMBER.from) {
    plan.replaceNode(node.getNameNode(), RENAMED_MEMBER.to);
  } else if (Node.isPropertyAssignment(node) && node.getName() === RENAMED_MEMBER.from) {
    plan.replaceNode(node.getNameNode(), RENAMED_MEMBER.to);
  } else if (Node.isShorthandPropertyAssignment(node) && node.getName() === RENAMED_MEMBER.from) {
    plan.replaceNode(node, `${RENAMED_MEMBER.to}: ${RENAMED_MEMBER.from}`);
  } else if (Node.isBindingElement(node)) {
    const key = node.getPropertyNameNode();
    if (key === undefined && node.getName() === RENAMED_MEMBER.from) {
      plan.replaceNode(node.getNameNode(), `${RENAMED_MEMBER.to}: ${RENAMED_MEMBER.from}`);
    } else if (key?.getText() === RENAMED_MEMBER.from) {
      plan.replaceNode(key, RENAMED_MEMBER.to);
    } else return false;
  } else return false;
  plan.recordRewrite(node, `${RENAMED_MEMBER.from} -> ${RENAMED_MEMBER.to}`);
  return true;
}
