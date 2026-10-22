// Reload snippet injected into every page-load so the browser
// subscribes to /_reload without the HTML needing to hard-code it.
//
// Two reload triggers:
//   - explicit `reload` event from the server after hot reload (rebuild + send)
//   - implicit `boot` event on every SSE connection, containing the current
//     server process's bootId. The snippet remembers the first bootId; if a
//     reconnect receives a different one, it refreshes. Otherwise the
//     browser could remain on a stale bundle after a server restart.
const RELOAD_SNIPPET = `
<script>
  (() => {
    const es = new EventSource("/_reload");
    let firstBootId = null;
    es.addEventListener("boot", (e) => {
      if (firstBootId === null) {
        firstBootId = e.data;
      } else if (firstBootId !== e.data) {
        location.reload();
      }
    });
    es.addEventListener("reload", () => location.reload());
  })();
</script>
`;

export function injectReload(html: string): string {
  if (html.includes("/_reload")) return html;
  return html.includes("</body>")
    ? html.replace("</body>", `${RELOAD_SNIPPET}</body>`)
    : html + RELOAD_SNIPPET;
}

type ReloadClient = {
  readonly controller: ReadableStreamDefaultController<Uint8Array>;
  readonly encoder: TextEncoder;
  closed: boolean;
};

export type DevReloadHub = {
  // Identifies this server process instance; see RELOAD_SNIPPET.
  readonly bootId: string;
  readonly clients: Set<ReloadClient>;
};

export function createReloadHub(): DevReloadHub {
  return { bootId: String(Date.now()), clients: new Set<ReloadClient>() };
}

// JSON-encoded so a filename can never break the SSE framing.
export function broadcastReload(hub: DevReloadHub, changedFile: string): void {
  const payload = `event: reload\ndata: ${JSON.stringify(changedFile)}\n\n`;
  for (const client of hub.clients) {
    if (client.closed) continue;
    try {
      client.controller.enqueue(client.encoder.encode(payload));
    } catch {
      client.closed = true;
    }
  }
}

export function openReloadStream(hub: DevReloadHub): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const entry: ReloadClient = { controller, encoder, closed: false };
      hub.clients.add(entry);
      controller.enqueue(encoder.encode(": connected\n\n"));
      controller.enqueue(encoder.encode(`event: boot\ndata: ${hub.bootId}\n\n`));
    },
    cancel() {
      for (const c of hub.clients) {
        if (c.closed) hub.clients.delete(c);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
