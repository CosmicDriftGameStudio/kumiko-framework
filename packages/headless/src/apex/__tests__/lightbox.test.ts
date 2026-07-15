import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { APEX_LIGHTBOX_SCRIPT, APEX_LIGHTBOX_SCRIPT_CSP_HASH } from "../index";

function scriptBody(html: string): string {
  const match = html.match(/^<script>(?<body>[\s\S]*)<\/script>$/);
  const body = match?.groups?.["body"];
  if (body === undefined) {
    throw new Error("APEX_LIGHTBOX_SCRIPT isn't a single <script>...</script> string");
  }
  return body;
}

describe("APEX_LIGHTBOX_SCRIPT_CSP_HASH", () => {
  test("matches the actual script content byte-for-byte", () => {
    const body = scriptBody(APEX_LIGHTBOX_SCRIPT);
    const hash = `sha256-${createHash("sha256").update(body).digest("base64")}`;
    expect(hash).toBe(APEX_LIGHTBOX_SCRIPT_CSP_HASH);
  });
});
