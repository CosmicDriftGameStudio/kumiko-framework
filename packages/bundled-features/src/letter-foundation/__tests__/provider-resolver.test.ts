import { describe, expect, test } from "bun:test";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { LETTER_LIVE_CONFIG } from "../constants.ts";
import { LetterProviderNotConfiguredError, selectLetterProvider } from "../provider-resolver.ts";
import { fakeConfigAccessor } from "./fake-config.ts";

function usageOf(name: string) {
  return {
    extensionName: "letter-provider",
    entityName: name,
    options: { capabilities: {}, build: () => undefined },
  };
}

function registryOf(...names: string[]) {
  return { getExtensionUsages: () => names.map(usageOf) };
}

const switchedOn = fakeConfigAccessor({ [LETTER_LIVE_CONFIG.name]: true });
const switchedOff = fakeConfigAccessor({ [LETTER_LIVE_CONFIG.name]: false });

const inProduction = <T>(run: () => Promise<T>) => withEnv({ NODE_ENV: "production" }, run);
const outsideProduction = <T>(run: () => Promise<T>) => withEnv({ NODE_ENV: "test" }, run);

describe("selectLetterProvider outside production", () => {
  test("selects the simulator whatever the live switch says", async () => {
    const registry = registryOf("inmemory", "letterxpress");
    for (const config of [switchedOn, switchedOff, undefined]) {
      const selected = await outsideProduction(() => selectLetterProvider({ registry, config }));
      expect(selected).toMatchObject({ name: "inmemory", live: false });
    }
  });

  test("refuses when the simulator is not mounted", async () => {
    await expect(
      outsideProduction(() =>
        selectLetterProvider({ registry: registryOf("letterxpress"), config: switchedOn }),
      ),
    ).rejects.toThrow(LetterProviderNotConfiguredError);
  });
});

describe("selectLetterProvider in production", () => {
  test("a switch that is off or unreadable is refused instead of simulating", async () => {
    const registry = registryOf("inmemory", "letterxpress");
    for (const config of [switchedOff, fakeConfigAccessor({}), undefined]) {
      await expect(inProduction(() => selectLetterProvider({ registry, config }))).rejects.toThrow(
        LetterProviderNotConfiguredError,
      );
    }
  });

  test("a switch that is on selects the one real provider as live", async () => {
    const selected = await inProduction(() =>
      selectLetterProvider({
        registry: registryOf("inmemory", "letterxpress"),
        config: switchedOn,
      }),
    );
    expect(selected).toMatchObject({ name: "letterxpress", live: true });
  });

  test("without a real provider the error says to mount one", async () => {
    await expect(
      inProduction(() =>
        selectLetterProvider({ registry: registryOf("inmemory"), config: switchedOn }),
      ),
    ).rejects.toThrow("Mount a letter-provider-* feature");
  });

  test("two real providers are refused with their names", async () => {
    await expect(
      inProduction(() =>
        selectLetterProvider({
          registry: registryOf("inmemory", "letterxpress", "other"),
          config: switchedOn,
        }),
      ),
    ).rejects.toThrow("letterxpress, other");
  });
});
