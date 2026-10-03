import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  APEX_LIGHTBOX_HTML,
  APEX_LIGHTBOX_SCRIPT,
  APEX_LIGHTBOX_SCRIPT_CSP_HASH,
} from "../index.js";

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

describe("Apex lightbox navigation", () => {
  test("markup has labelled previous and next buttons", () => {
    expect(APEX_LIGHTBOX_HTML).toContain(
      'class="apex-lightbox__prev" aria-label="Previous screenshot"',
    );
    expect(APEX_LIGHTBOX_HTML).toContain(
      'class="apex-lightbox__next" aria-label="Next screenshot"',
    );
  });

  test("script handles arrow keys", () => {
    expect(APEX_LIGHTBOX_SCRIPT).toContain("ArrowLeft");
    expect(APEX_LIGHTBOX_SCRIPT).toContain("ArrowRight");
  });
});
