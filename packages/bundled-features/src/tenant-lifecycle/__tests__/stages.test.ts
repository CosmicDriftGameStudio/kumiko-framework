import { describe, expect, test } from "bun:test";
import { DESTRUCTION_STAGES, isDestructionPipelineComplete, pickNextStage } from "../stages";

describe("tenant-lifecycle stages", () => {
  test("pickNextStage halts when any stage was abandoned", () => {
    const completed = new Set(["external-resources", "search-indices"]);
    const abandoned = new Set(["app-data"]);
    expect(pickNextStage(completed, abandoned)).toBeNull();
  });

  test("pickNextStage returns first incomplete stage when healthy", () => {
    const completed = new Set(["external-resources"]);
    expect(pickNextStage(completed, new Set())?.name).toBe("search-indices");
  });

  test("isDestructionPipelineComplete requires every stage", () => {
    const partial = new Set(DESTRUCTION_STAGES.slice(0, 3).map((s) => s.name));
    expect(isDestructionPipelineComplete(partial)).toBe(false);
    const all = new Set(DESTRUCTION_STAGES.map((s) => s.name));
    expect(isDestructionPipelineComplete(all)).toBe(true);
  });
});
