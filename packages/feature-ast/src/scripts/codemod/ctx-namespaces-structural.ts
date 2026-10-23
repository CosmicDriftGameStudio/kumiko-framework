import {
  type BindingElement,
  Node,
  type ObjectBindingPattern,
  type ObjectLiteralElementLike,
  type ObjectLiteralExpression,
  type SpreadAssignment,
  SyntaxKind,
  type Type,
} from "ts-morph";
import { decideMove, receiverOf, spreadMayCarryNamespace } from "./ctx-namespaces-detect.ts";
import type { EditPlan, RenderRange } from "./ctx-namespaces-edits.ts";
import { describePath, type NamespacePath } from "./ctx-namespaces-mapping.ts";

interface MovedItem<TNode extends Node> {
  readonly node: TNode;
  readonly key: string;
  readonly path: NamespacePath;
}

type EntryText = string | ((renderRange: RenderRange) => string);

function groupByNamespace<TNode extends Node>(
  items: readonly MovedItem<TNode>[],
): Map<string, MovedItem<TNode>[]> {
  const groups = new Map<string, MovedItem<TNode>[]>();
  for (const item of items) {
    const group = groups.get(item.path.namespace) ?? [];
    group.push(item);
    groups.set(item.path.namespace, group);
  }
  return groups;
}

function joinEntries(entries: readonly EntryText[], separator: string): EntryText {
  return (renderRange) =>
    entries
      .map((entry) => (typeof entry === "string" ? entry : entry(renderRange)))
      .join(separator);
}

function wrapNamespace(namespace: string, entries: EntryText): EntryText {
  return typeof entries === "string"
    ? `${namespace}: { ${entries} }`
    : (renderRange) => `${namespace}: { ${entries(renderRange)} }`;
}

function bindingKey(element: BindingElement): string | undefined {
  const propertyName = element.getPropertyNameNode();
  if (propertyName === undefined) return element.getNameNode().getText();
  if (Node.isIdentifier(propertyName)) return propertyName.getText();
  return Node.isStringLiteral(propertyName) ? propertyName.getLiteralText() : undefined;
}

function bindingEntry(path: NamespacePath, local: string): string {
  return path.leaf === local ? local : `${path.leaf}: ${local}`;
}

function collectMovedBindings(
  plan: EditPlan,
  pattern: ObjectBindingPattern,
  type: Type,
): MovedItem<BindingElement>[] {
  const moved: MovedItem<BindingElement>[] = [];
  for (const element of pattern.getElements()) {
    const key = element.getDotDotDotToken() === undefined ? bindingKey(element) : undefined;
    if (key === undefined) continue;
    const decision = decideMove(receiverOf(type, key), key, false);
    if (decision.status === "manual") plan.flagManual(element, decision.reason);
    if (decision.status === "move") moved.push({ node: element, key, path: decision.path });
  }
  return moved;
}

function bindingBlocker(
  pattern: ObjectBindingPattern,
  moved: readonly MovedItem<BindingElement>[],
): string | undefined {
  if (pattern.getElements().some((element) => element.getDotDotDotToken() !== undefined)) {
    return "destructuring with a rest element next to moved context members";
  }
  for (const { node, key } of moved) {
    if (node.getInitializer() !== undefined) return `${key}: destructured with a default value`;
    if (!Node.isIdentifier(node.getNameNode())) return `${key}: destructured into a nested pattern`;
  }
  return undefined;
}

export function planBindingPattern(
  plan: EditPlan,
  pattern: ObjectBindingPattern,
  type: Type,
): void {
  const moved = collectMovedBindings(plan, pattern, type);
  if (moved.length === 0) return;
  const blocker = bindingBlocker(pattern, moved);
  if (blocker !== undefined) {
    plan.flagManual(pattern, blocker);
    return;
  }
  for (const [namespace, items] of groupByNamespace(moved)) {
    planBindingGroup(plan, pattern, namespace, items);
  }
}

function planBindingGroup(
  plan: EditPlan,
  pattern: ObjectBindingPattern,
  namespace: string,
  items: readonly MovedItem<BindingElement>[],
): void {
  const entry = items.map(({ node, path }) => bindingEntry(path, node.getNameNode().getText()));
  const existing = pattern
    .getElements()
    .find((element) => bindingKey(element) === namespace && !items.some((i) => i.node === element));
  const nested = existing?.getNameNode();
  if (existing !== undefined && !(Node.isObjectBindingPattern(nested) && !hasRest(nested))) {
    plan.flagManual(existing, `${namespace} is already bound next to ${items[0]?.key ?? ""}`);
    return;
  }
  if (Node.isObjectBindingPattern(nested)) {
    plan.insertIntoList(nested, nested.getElements(), entry.join(", "));
    for (const item of items) plan.deleteListItem(item.node);
  } else {
    const [first, ...rest] = items;
    if (first === undefined) return;
    plan.replaceNode(first.node, `${namespace}: { ${entry.join(", ")} }`);
    for (const item of rest) plan.deleteListItem(item.node);
  }
  for (const item of items) {
    plan.recordRewrite(item.node, `destructured ${item.key} -> ${describePath(item.path)}`);
  }
}

function hasRest(pattern: ObjectBindingPattern): boolean {
  return pattern.getElements().some((element) => element.getDotDotDotToken() !== undefined);
}

function literalKey(property: ObjectLiteralElementLike): string | undefined {
  if (Node.isSpreadAssignment(property)) return undefined;
  const name = property.getNameNode();
  if (Node.isIdentifier(name)) return name.getText();
  return Node.isStringLiteral(name) ? name.getLiteralText() : undefined;
}

function literalEntry(
  plan: EditPlan,
  property: ObjectLiteralElementLike,
  path: NamespacePath,
): EntryText {
  if (Node.isPropertyAssignment(property)) {
    const initializer = property.getInitializerOrThrow();
    return (renderRange) =>
      `${path.leaf}: ${renderRange(initializer.getStart(), initializer.getEnd())}`;
  }
  if (Node.isShorthandPropertyAssignment(property)) {
    const name = property.getName();
    return name === path.leaf ? name : `${path.leaf}: ${name}`;
  }
  if (Node.isSpreadAssignment(property)) return "";
  const name = property.getNameNode();
  return (renderRange) =>
    plan.source.slice(property.getStart(), name.getStart()) +
    path.leaf +
    renderRange(name.getEnd(), property.getEnd());
}

function collectMovedProperties(
  plan: EditPlan,
  literal: ObjectLiteralExpression,
  type: Type,
): MovedItem<ObjectLiteralElementLike>[] {
  const moved: MovedItem<ObjectLiteralElementLike>[] = [];
  for (const property of literal.getProperties()) {
    const key = literalKey(property);
    if (key === undefined) continue;
    const decision = decideMove(receiverOf(type, key), key, false);
    if (decision.status === "manual") plan.flagManual(property, decision.reason);
    if (decision.status === "move") moved.push({ node: property, key, path: decision.path });
  }
  return moved;
}

export function planObjectLiteral(
  plan: EditPlan,
  literal: ObjectLiteralExpression,
  type: Type,
): void {
  const moved = collectMovedProperties(plan, literal, type);
  if (moved.length === 0) return;
  const spreads = literal.getProperties().filter((property) => Node.isSpreadAssignment(property));
  for (const [namespace, items] of groupByNamespace(moved)) {
    planLiteralGroup(plan, literal, namespace, items, spreads);
  }
}

function isSideEffectFree(expression: Node): boolean {
  if (Node.isIdentifier(expression) || expression.getKind() === SyntaxKind.ThisKeyword) return true;
  return (
    Node.isPropertyAccessExpression(expression) && isSideEffectFree(expression.getExpression())
  );
}

function conflictingSpreads(
  spreads: readonly ObjectLiteralElementLike[],
  namespace: string,
): SpreadAssignment[] {
  return spreads.filter(
    (spread): spread is SpreadAssignment =>
      Node.isSpreadAssignment(spread) &&
      spreadMayCarryNamespace(spread.getExpression().getType(), namespace),
  );
}

function spreadBlocker(
  namespace: string,
  items: readonly MovedItem<ObjectLiteralElementLike>[],
  conflicts: readonly SpreadAssignment[],
  hasExisting: boolean,
): string | undefined {
  const key = items[0]?.key ?? "";
  if (namespace === "db") return `${key}: a spread carrying db would break the TenantDb identity`;
  if (hasExisting) return `${key}: spread and an existing ${namespace} key in one literal`;
  if (conflicts.some((spread) => !isSideEffectFree(spread.getExpression()))) {
    return `${key}: a spread call may carry ${namespace}; spread its result by hand`;
  }
  const lastSpreadStart = Math.max(...conflicts.map((spread) => spread.getStart()));
  if (items.some((item) => item.node.getStart() < lastSpreadStart)) {
    return `${key}: moved member sits before a spread that carries ${namespace}`;
  }
  return undefined;
}

function planLiteralGroup(
  plan: EditPlan,
  literal: ObjectLiteralExpression,
  namespace: string,
  items: readonly MovedItem<ObjectLiteralElementLike>[],
  spreads: readonly ObjectLiteralElementLike[],
): void {
  const [first, ...rest] = items;
  if (first === undefined) return;
  const entries = items.map(({ node, path }) => literalEntry(plan, node, path));
  const existing = literal.getProperty(namespace);
  const conflicts = conflictingSpreads(spreads, namespace);
  const blocker =
    conflicts.length > 0
      ? spreadBlocker(namespace, items, conflicts, existing !== undefined)
      : undefined;
  if (blocker !== undefined) {
    plan.flagManual(first.node, blocker);
    return;
  }
  const nested = Node.isPropertyAssignment(existing) ? existing.getInitializer() : undefined;
  if (existing !== undefined && namespace === "db" && !Node.isObjectLiteralExpression(nested)) {
    plan.flagManual(existing, `${namespace} is already set to a non-literal next to ${first.key}`);
    return;
  }
  if (Node.isObjectLiteralExpression(nested)) {
    plan.insertIntoList(nested, nested.getProperties(), joinEntries(entries, ", "));
    for (const item of items) plan.deleteListItem(item.node);
  } else if (existing !== undefined) {
    plan.replaceNode(
      existing,
      wrapNamespace(namespace, withSpreads([existingValueText(plan, existing)], entries)),
    );
    for (const item of items) plan.deleteListItem(item.node);
  } else {
    const spreadTexts = conflicts.map(
      (spread) => `...${spread.getExpression().getText()}.${namespace}`,
    );
    plan.replaceNode(first.node, wrapNamespace(namespace, withSpreads(spreadTexts, entries)));
    for (const item of rest) plan.deleteListItem(item.node);
  }
  for (const item of items) {
    plan.recordRewrite(item.node, `object key ${item.key} -> ${describePath(item.path)}`);
  }
}

function withSpreads(spreadTexts: readonly string[], entries: readonly EntryText[]): EntryText {
  return joinEntries([...spreadTexts, ...entries], ", ");
}

function existingValueText(plan: EditPlan, existing: Node): string {
  if (Node.isShorthandPropertyAssignment(existing)) return `...${existing.getName()}`;
  const initializer = Node.isPropertyAssignment(existing) ? existing.getInitializer() : undefined;
  return `...${initializer === undefined ? "" : plan.source.slice(initializer.getStart(), initializer.getEnd())}`;
}
