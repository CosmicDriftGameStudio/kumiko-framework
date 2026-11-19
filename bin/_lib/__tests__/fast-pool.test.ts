import { describe, expect, test } from "bun:test";
import { computeFastPool } from "../fast-pool";

const GIB = 1024 ** 3;
const idle = { override: undefined, loadAverage1Min: 0 };

describe("computeFastPool", () => {
  test("a 16 GB runner with 4 idle cores runs two fast steps, not three", () => {
    expect(computeFastPool({ ...idle, cores: 4, totalMemoryBytes: 16 * GIB })).toBe(2);
  });

  test("a large machine keeps the CPU-sized pool", () => {
    expect(computeFastPool({ ...idle, cores: 12, totalMemoryBytes: 64 * GIB })).toBe(11);
  });

  test("a busy large machine shrinks to its free cores", () => {
    expect(
      computeFastPool({ ...idle, cores: 12, loadAverage1Min: 9.4, totalMemoryBytes: 64 * GIB }),
    ).toBe(3);
  });

  test("the memory cap never raises a smaller CPU pool", () => {
    expect(computeFastPool({ ...idle, cores: 1, totalMemoryBytes: 8 * GIB })).toBe(1);
  });

  test("KUMIKO_FAST_POOL wins over the memory cap", () => {
    expect(computeFastPool({ ...idle, override: "4", cores: 4, totalMemoryBytes: 16 * GIB })).toBe(
      4,
    );
  });

  test("an empty or invalid override falls back to the computed pool", () => {
    expect(computeFastPool({ ...idle, override: "", cores: 4, totalMemoryBytes: 16 * GIB })).toBe(2);
    expect(computeFastPool({ ...idle, override: "x", cores: 4, totalMemoryBytes: 16 * GIB })).toBe(
      2,
    );
  });
});
