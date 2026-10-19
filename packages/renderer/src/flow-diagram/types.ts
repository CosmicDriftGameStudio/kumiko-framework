export type FlowIcon =
  | "ui"
  | "api"
  | "handler"
  | "event-store"
  | "database"
  | "broadcast"
  | "ai"
  | "inbox"
  | "person"
  | "check"
  | "stop"
  | "box";

export type FlowNodeKind = "process" | "decision" | "terminal";

export interface FlowNode {
  id: string;
  title: string;
  sub?: string;
  icon?: FlowIcon;
  kind?: FlowNodeKind;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowSpec {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
