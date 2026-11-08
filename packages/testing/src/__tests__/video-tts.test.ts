import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pcmDurationMs, pcmToWav, synthesizeSpeech } from "../e2e/video/tts";

function fakeFetch(status = 200, body: Uint8Array<ArrayBuffer> = new Uint8Array(48_000)) {
  const requests: Array<{
    url: string;
    headers: Record<string, string>;
    body: Record<string, unknown>;
  }> = [];
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    requests.push({
      url: String(url),
      headers: Object.fromEntries(new Headers(init.headers)),
      body: JSON.parse(String(init.body)),
    });
    return new Response(status === 200 ? body : "upstream exploded", { status });
  };
  return { impl, requests };
}

const tmp = () => mkdtempSync(join(tmpdir(), "video-tts-"));

describe("pcmToWav", () => {
  test("writes a mono 16-bit 24 kHz header and keeps the samples", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const wav = pcmToWav(pcm);
    const view = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(36 + 4);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint32(28, true)).toBe(48_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4);
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4]);
  });

  test("48000 bytes of PCM last one second", () => {
    expect(pcmDurationMs(48_000)).toBe(1000);
  });
});

describe("synthesizeSpeech", () => {
  const voice = { voice: "Kore", instructions: "calm" };

  test("requests raw pcm and lets scene instructions win over the video default", async () => {
    const { impl, requests } = fakeFetch();
    const result = await synthesizeSpeech({
      text: "Hello",
      voice,
      sceneInstructions: "excited",
      cacheDir: tmp(),
      apiKey: "secret-key",
      fetchImpl: impl,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.headers["authorization"]).toBe("Bearer secret-key");
    expect(requests[0]?.body).toEqual({
      model: "google/gemini-3.8-flash-tts",
      input: "Hello",
      voice: "Kore",
      response_format: "pcm",
      instructions: "excited",
    });
    expect(result.durationMs).toBe(1000);
    expect(readFileSync(result.wavPath).byteLength).toBe(44 + 48_000);
  });

  test("omits instructions when neither video nor scene sets them", async () => {
    const { impl, requests } = fakeFetch();
    await synthesizeSpeech({
      text: "Hi",
      voice: { voice: "Kore" },
      cacheDir: tmp(),
      apiKey: "k",
      fetchImpl: impl,
    });
    expect(requests[0]?.body).not.toHaveProperty("instructions");
  });

  test("a cache hit does not call the API again", async () => {
    const { impl, requests } = fakeFetch();
    const cacheDir = tmp();
    const first = await synthesizeSpeech({
      text: "Hello",
      voice,
      cacheDir,
      apiKey: "k",
      fetchImpl: impl,
    });
    const second = await synthesizeSpeech({
      text: "Hello",
      voice,
      cacheDir,
      apiKey: undefined,
      fetchImpl: impl,
    });
    expect(requests).toHaveLength(1);
    expect(second).toEqual(first);
  });

  test("different instructions are different cache entries", async () => {
    const { impl, requests } = fakeFetch();
    const cacheDir = tmp();
    await synthesizeSpeech({ text: "Hello", voice, cacheDir, apiKey: "k", fetchImpl: impl });
    await synthesizeSpeech({
      text: "Hello",
      voice,
      sceneInstructions: "x",
      cacheDir,
      apiKey: "k",
      fetchImpl: impl,
    });
    expect(requests).toHaveLength(2);
  });

  test("a non-200 answer fails with status and body but never the key", async () => {
    const { impl } = fakeFetch(400);
    const cacheDir = tmp();
    const error = await synthesizeSpeech({
      text: "Hello",
      voice,
      cacheDir,
      apiKey: "secret-key",
      fetchImpl: impl,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("400");
    expect(message).toContain("upstream exploded");
    expect(message).not.toContain("secret-key");
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  test("an empty or odd-length answer fails and leaves no cache entry", async () => {
    for (const body of [new Uint8Array(0), new Uint8Array(3)]) {
      const { impl } = fakeFetch(200, body);
      const cacheDir = tmp();
      await expect(
        synthesizeSpeech({ text: "Hello", voice, cacheDir, apiKey: "k", fetchImpl: impl }),
      ).rejects.toThrow("PCM");
      expect(readdirSync(cacheDir)).toEqual([]);
    }
  });

  test("a missing key fails before any request", async () => {
    const { impl, requests } = fakeFetch();
    await expect(
      synthesizeSpeech({
        text: "Hello",
        voice,
        cacheDir: tmp(),
        apiKey: undefined,
        fetchImpl: impl,
      }),
    ).rejects.toThrow("OPENROUTER_API_KEY");
    expect(requests).toHaveLength(0);
  });
});
