import { describe, expect, test } from "bun:test";
import { createFileContext, createFileHandle, deriveKey } from "../file-handle";
import { createInMemoryFileProvider } from "../in-memory-provider";

describe("deriveKey", () => {
  test("inserts suffix before extension", () => {
    expect(deriveKey("foo/bar.jpg", "medium")).toBe("foo/bar.medium.jpg");
  });

  test("handles keys without a slash", () => {
    expect(deriveKey("bar.png", "thumb")).toBe("bar.thumb.png");
  });

  test("appends to keys without an extension", () => {
    expect(deriveKey("foo/bar", "small")).toBe("foo/bar.small");
  });

  test("only splits on the last segment — earlier dots stay", () => {
    expect(deriveKey("archive.v2/foo.jpg", "medium")).toBe("archive.v2/foo.medium.jpg");
  });

  test("handles multi-dot filenames — splits on the final extension", () => {
    expect(deriveKey("tenant/my.photo.jpg", "thumb")).toBe("tenant/my.photo.thumb.jpg");
  });
});

describe("FileHandle", () => {
  test("read/write round-trip through the provider", async () => {
    const provider = createInMemoryFileProvider();
    const handle = createFileHandle("tenant/x.jpg", provider);

    const payload = new Uint8Array([1, 2, 3, 4]);
    await handle.write(payload, "image/jpeg");

    const read = await handle.read();
    expect(Array.from(read)).toEqual([1, 2, 3, 4]);
  });

  test("exists reflects write/delete state", async () => {
    const provider = createInMemoryFileProvider();
    const handle = createFileHandle("tenant/x.jpg", provider);

    expect(await handle.exists()).toBe(false);
    await handle.write(new Uint8Array([9]));
    expect(await handle.exists()).toBe(true);
    await handle.delete();
    expect(await handle.exists()).toBe(false);
  });

  test("derive produces an independent handle at the derived key", async () => {
    const provider = createInMemoryFileProvider();
    const original = createFileHandle("tenant/photo.jpg", provider);
    const thumb = original.derive("thumb");

    expect(thumb.key).toBe("tenant/photo.thumb.jpg");

    await original.write(new Uint8Array([1, 2]));
    await thumb.write(new Uint8Array([9, 9, 9]));

    expect(Array.from(await original.read())).toEqual([1, 2]);
    expect(Array.from(await thumb.read())).toEqual([9, 9, 9]);
    // Deleting the derived handle must not touch the original.
    await thumb.delete();
    expect(await original.exists()).toBe(true);
  });

  test("writes copy the buffer — caller mutations don't corrupt stored data", async () => {
    const provider = createInMemoryFileProvider();
    const handle = createFileHandle("tenant/x.bin", provider);

    const buf = new Uint8Array([1, 2, 3]);
    await handle.write(buf);
    buf[0] = 99;

    const read = await handle.read();
    expect(Array.from(read)).toEqual([1, 2, 3]);
  });
});

describe("createFileContext", () => {
  test("ref returns a handle bound to the given key", async () => {
    const provider = createInMemoryFileProvider();
    const files = createFileContext(provider);

    const h = files.ref("tenant/foo.pdf");
    expect(h.key).toBe("tenant/foo.pdf");
    await h.write(new Uint8Array([7]));

    // Same key, new ref — should see the same stored bytes.
    const h2 = files.ref("tenant/foo.pdf");
    expect(Array.from(await h2.read())).toEqual([7]);
  });
});

describe("InMemoryFileProvider", () => {
  test("keys() lists every stored key", async () => {
    const provider = createInMemoryFileProvider();
    await provider.write("a/x.jpg", new Uint8Array([1]));
    await provider.write("b/y.png", new Uint8Array([2]));
    expect([...provider.keys()].sort()).toEqual(["a/x.jpg", "b/y.png"]);
  });

  test("read on a missing key throws with the key in the message", async () => {
    const provider = createInMemoryFileProvider();
    await expect(provider.read("nope.jpg")).rejects.toThrow(/nope\.jpg/);
  });

  test("clear() empties the store", async () => {
    const provider = createInMemoryFileProvider();
    await provider.write("a.jpg", new Uint8Array([1]));
    provider.clear();
    expect(provider.keys()).toEqual([]);
    expect(await provider.exists("a.jpg")).toBe(false);
  });

  test("overwrite replaces bytes in place", async () => {
    const provider = createInMemoryFileProvider();
    await provider.write("a.jpg", new Uint8Array([1, 2]));
    await provider.write("a.jpg", new Uint8Array([9, 9, 9]));
    expect(Array.from(await provider.read("a.jpg"))).toEqual([9, 9, 9]);
  });
});
