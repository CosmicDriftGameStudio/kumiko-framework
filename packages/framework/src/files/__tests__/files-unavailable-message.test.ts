import { describe, expect, test } from "bun:test";
import { filesUnavailableMessage } from "../create-file-ref-from-bytes.ts";

describe("filesUnavailableMessage", () => {
  test("names the caller and the missing resolver instead of a missing feature", () => {
    const message = filesUnavailableMessage("createFileRefFromBytes");
    expect(message).toStartWith("createFileRefFromBytes: ctx.files is unavailable");
    expect(message).toContain("no file-provider resolver is wired");
    expect(message).toContain("withFileProviderResolver");
    expect(message).not.toContain("mount a file-provider feature to store files");
  });
});
