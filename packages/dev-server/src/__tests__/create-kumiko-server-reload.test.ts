import { describe, expect, test } from "bun:test";
import {
  broadcastReload,
  createReloadHub,
  openReloadStream,
} from "../create-kumiko-server-reload.ts";

describe("openReloadStream", () => {
  test("cancelling a stream removes its own client from the hub", async () => {
    const hub = createReloadHub();
    const response = openReloadStream(hub);
    expect(hub.clients.size).toBe(1);

    await response.body?.cancel();

    expect(hub.clients.size).toBe(0);
  });

  test("cancelling one of two streams keeps the other receiving reloads", async () => {
    const hub = createReloadHub();
    const cancelled = openReloadStream(hub);
    const live = openReloadStream(hub);
    const reader = live.body?.getReader();
    await reader?.read();
    await reader?.read();

    await cancelled.body?.cancel();
    expect(hub.clients.size).toBe(1);

    broadcastReload(hub, "a.ts");
    const chunk = await reader?.read();
    expect(new TextDecoder().decode(chunk?.value)).toContain('event: reload\ndata: "a.ts"');
  });
});
