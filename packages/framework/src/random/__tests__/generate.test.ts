import { describe, expect, test } from "bun:test";
import { generateAdjNounName, generateNoConfusableId } from "../generate.ts";
import { generateUniqueName } from "../index.ts";
import { ADJECTIVES, NOUNS } from "../words.ts";

describe("generateAdjNounName", () => {
  test("default: <adj>-<noun> aus den Standard-Listen", () => {
    const name = generateAdjNounName();
    const [adj, noun, ...rest] = name.split("-");
    expect(rest).toEqual([]);
    expect(ADJECTIVES).toContain(adj!);
    expect(NOUNS).toContain(noun!);
  });

  test("custom separator", () => {
    const name = generateAdjNounName({ separator: "_" });
    expect(name).toMatch(/^[a-z]+_[a-z]+$/);
    const [adj, noun] = name.split("_");
    expect(ADJECTIVES).toContain(adj!);
    expect(NOUNS).toContain(noun!);
  });

  test("with suffix: <adj>-<noun>-<suffix>", () => {
    const name = generateAdjNounName({ suffix: { length: 3 } });
    const parts = name.split("-");
    expect(parts).toHaveLength(3);
    const [adj, noun, suffix] = parts;
    expect(ADJECTIVES).toContain(adj!);
    expect(NOUNS).toContain(noun!);
    expect(suffix!).toMatch(/^[a-z2-9]{3}$/);
    // No-confusable: excludes 0/1/o/l/i
    expect(suffix!).not.toMatch(/[01oli]/);
  });

  test("custom adjectives + nouns Wahl", () => {
    const name = generateAdjNounName({
      adjectives: ["rapid"],
      nouns: ["receiver"],
    });
    expect(name).toBe("rapid-receiver");
  });

  test("Statistical: 100 Generierungen → mindestens 5 verschiedene", () => {
    const names = new Set<string>();
    for (let i = 0; i < 100; i++) {
      names.add(generateAdjNounName());
    }
    // 22500 combos, 100 picks → expected diversity is high.
    // Lower bound 5 only catches a complete RNG failure.
    expect(names.size).toBeGreaterThan(5);
  });
});

describe("generateNoConfusableId", () => {
  test("returns a string of the requested length", () => {
    expect(generateNoConfusableId(8)).toHaveLength(8);
    expect(generateNoConfusableId(1)).toHaveLength(1);
  });

  test("only characters from the no-confusable alphabet", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateNoConfusableId(10);
      expect(id).toMatch(/^[a-z2-9]+$/);
      expect(id).not.toMatch(/[01oli]/);
    }
  });

  test("length < 1 wirft", () => {
    expect(() => generateNoConfusableId(0)).toThrow(/length must be ≥ 1/);
    expect(() => generateNoConfusableId(-3)).toThrow(/length must be ≥ 1/);
  });

  test("Statistical: 200 IDs of length 8 → all unique", () => {
    // 32^8 = 1 Trillion combos → 200 picks haben praktisch 0 % Kollision.
    const ids = new Set<string>();
    for (let i = 0; i < 200; i++) {
      ids.add(generateNoConfusableId(8));
    }
    expect(ids.size).toBe(200);
  });
});

describe("generateUniqueName", () => {
  test("isAvailable=true on the first try → returns clean (no suffix)", async () => {
    const seen: string[] = [];
    const name = await generateUniqueName({
      isAvailable: async (n) => {
        seen.push(n);
        return true;
      },
    });
    expect(seen).toHaveLength(1);
    expect(name).toBe(seen[0]!);
    // Clean = only 2 parts (adj + noun), no suffix
    expect(name.split("-")).toHaveLength(2);
  });

  test("after 3 collisions switches to suffix mode", async () => {
    const tried: string[] = [];
    const name = await generateUniqueName({
      maxCleanAttempts: 3,
      isAvailable: async (n) => {
        tried.push(n);
        // The first 3 are taken; the 4th attempt (suffix-mode) wins.
        return tried.length === 4;
      },
    });
    expect(tried).toHaveLength(4);
    // First 3 without suffix
    for (let i = 0; i < 3; i++) {
      expect(tried[i]!.split("-")).toHaveLength(2);
    }
    // 4. Versuch hat suffix
    expect(tried[3]!.split("-")).toHaveLength(3);
    expect(name).toBe(tried[3]!);
  });

  test("throws when maxTotalAttempts is exhausted", async () => {
    await expect(
      generateUniqueName({
        isAvailable: async () => false,
        maxTotalAttempts: 5,
      }),
    ).rejects.toThrow(/failed to find available name after 5 attempts/);
  });

  test("respektiert custom Wortlisten", async () => {
    const name = await generateUniqueName({
      isAvailable: async () => true,
      adjectives: ["bold"],
      nouns: ["receiver"],
    });
    expect(name).toBe("bold-receiver");
  });

  test("config-Validierung: maxClean > maxTotal wirft", async () => {
    await expect(
      generateUniqueName({
        isAvailable: async () => true,
        maxCleanAttempts: 10,
        maxTotalAttempts: 5,
      }),
    ).rejects.toThrow(/maxCleanAttempts.*must not exceed maxTotalAttempts/);
  });
});
