// Fixture server for the screenshot runner specs: no app stack. "/" has a data
// fetch that can be made to hang, so a spec controls exactly which request is
// still in flight when it reloads or navigates. "/identity" shows an address the
// way an app shows the signed-in user, and renderIdentity() re-renders it from
// the query string like a framework re-render would.

const port = Number(process.env["PORT"] ?? 4195);

const PAGE = `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; min-height: 100vh; font: 24px sans-serif;
        background: linear-gradient(135deg, #1e3a8a, #9333ea 50%, #f59e0b); }
      #status { padding: 48px; color: white; }
    </style>
  </head>
  <body>
    <div id="status">loading</div>
    <script>
      const key = new URLSearchParams(location.search).get("key");
      fetch("/api/data?key=" + key)
        .then((response) => response.text())
        .then((text) => { document.getElementById("status").textContent = text; });
      window.fetchSlowThenPushState = () => {
        document.getElementById("status").textContent = "slow pending";
        fetch("/api/slow").then(() => {
          document.getElementById("status").textContent = "slow done";
        });
        history.pushState({}, "", "/same-document");
      };
    </script>
  </body>
</html>`;

const IDENTITY_PAGE = `<!doctype html>
<html>
  <head>
    <style>
      body { margin: 0; min-height: 100vh; font: 24px sans-serif; background: #f8fafc; color: #0f172a; }
      body.dark { background: #0f172a; color: #f8fafc; }
      main { padding: 48px; display: grid; gap: 24px; }
      input { font: inherit; width: 640px; padding: 8px; }
    </style>
  </head>
  <body>
    <main>
      <p id="who"></p>
      <input id="email" readonly />
    </main>
    <script>
      window.renderIdentity = () => {
        const email = new URLSearchParams(location.search).get("email") ?? "";
        document.getElementById("who").textContent = "Signed in as " + email;
        document.getElementById("email").value = email;
      };
      window.renderIdentity();
    </script>
  </body>
</html>`;

// Per key, the second /api/data request hangs until the browser drops it:
// the first load settles normally, a reload creates the dead request, and
// the next reload loads again.
const HANGING_REQUEST_NUMBER = 2;
const SLOW_RESPONSE_MS = 1500;
const requestCountByKey = new Map<string, number>();

function waitForClientAbort(request: Request): Promise<Response> {
  return new Promise((resolve) => {
    request.signal.addEventListener("abort", () => resolve(new Response(null, { status: 499 })));
  });
}

Bun.serve({
  port,
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/data") {
      const key = url.searchParams.get("key") ?? "";
      const count = (requestCountByKey.get(key) ?? 0) + 1;
      requestCountByKey.set(key, count);
      if (count === HANGING_REQUEST_NUMBER) return waitForClientAbort(request);
      return new Response(`loaded #${count}`);
    }
    if (url.pathname === "/api/slow") {
      await Bun.sleep(SLOW_RESPONSE_MS);
      return new Response("slow");
    }
    if (url.pathname === "/identity") {
      return new Response(IDENTITY_PAGE, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  },
});
