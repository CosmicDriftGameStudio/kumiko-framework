import { describe, expect, test } from "bun:test";
import { buildMultipartBody } from "../multipart-helper";

describe("buildMultipartBody", () => {
  test("serializes text fields so a Response can parse them back", async () => {
    const fd = new FormData();
    fd.set("title", "hello world");
    fd.set("count", "42");

    const { body, contentType } = await buildMultipartBody(fd);
    expect(contentType).toMatch(/^multipart\/form-data; boundary=kumikoBnd/i);

    const parsed = await new Response(body, { headers: { "content-type": contentType } }).formData();
    expect(parsed.get("title")).toBe("hello world");
    expect(parsed.get("count")).toBe("42");
  });

  test("carries file name and bytes through", async () => {
    const fd = new FormData();
    fd.set("doc", new File(["PDF-bytes"], "report.pdf", { type: "application/pdf" }));

    const { body, contentType } = await buildMultipartBody(fd);
    const text = typeof body === "string" ? body : await new Response(body).text();

    expect(contentType).toMatch(/^multipart\/form-data; boundary=kumikoBnd/i);
    expect(text).toContain('filename="report.pdf"');
    expect(text).toContain("PDF-bytes");
    expect(text.endsWith(`--${contentType.split("boundary=")[1]}--\r\n`)).toBe(true);
  });

  test("mixed fields and files round-trip together", async () => {
    const fd = new FormData();
    fd.set("note", "attached");
    fd.set("file", new File(["abc"], "a.txt"));

    const { body, contentType } = await buildMultipartBody(fd);
    const parsed = await new Response(body, { headers: { "content-type": contentType } }).formData();
    expect(parsed.get("note")).toBe("attached");
    // Structural check: happy-dom and bun can expose different File realms,
    // so instanceof would fail depending on file order in the same process.
    const file = parsed.get("file") as { name?: string; size?: number } | null;
    expect(file?.name).toBe("a.txt");
    expect(file?.size).toBe(3);
  });
});
