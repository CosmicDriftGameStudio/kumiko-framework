import { beforeAll, describe, expect, test } from "bun:test";
import { lookup } from "node:dns/promises";
import { egress } from "../egress";

// fw#2149 DoD requires proving TLS/SNI validation stays intact against a
// real HTTPS endpoint, not just a mock — the self-signed-cert tests in
// egress.test.ts pin the fetch-by-pinned-IP mechanism, this test pins it
// against a certificate chain issued by a real, publicly trusted CA.
// example.com is IANA-reserved and kept up for exactly this kind of use.
const REAL_HOST = "example.com";

let networkAvailable = true;

beforeAll(async () => {
  try {
    await lookup(REAL_HOST);
  } catch {
    networkAvailable = false;
  }
});

describe("egress external: real HTTPS endpoint", () => {
  test("connects through the pinned IP and validates the real certificate chain", async () => {
    if (!networkAvailable) {
      console.warn(
        `egress real-endpoint test skipped: DNS resolution for ${REAL_HOST} failed (no network in this environment)`,
      );
      return;
    }

    const fetchIt = egress({ kind: "external" });
    const res = await fetchIt(`https://${REAL_HOST}/`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Example Domain");
  });
});
