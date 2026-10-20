import { describe, expect, test } from "bun:test";
import { buildFileUploadFormData } from "../file-upload-form-data.ts";

describe("buildFileUploadFormData", () => {
  const file = new File(["x"], "a.png", { type: "image/png" });

  test("carries file, entityType, entityId and fieldName", () => {
    const formData = buildFileUploadFormData({
      file,
      entityType: "order",
      entityId: "rec-1",
      fieldName: "photo",
    });
    expect(formData.get("entityType")).toBe("order");
    expect(formData.get("entityId")).toBe("rec-1");
    expect(formData.get("fieldName")).toBe("photo");
    expect((formData.get("file") as File).name).toBe("a.png");
  });

  test("leaves out the parts that are undefined", () => {
    const formData = buildFileUploadFormData({ file, entityType: "order", fieldName: "photo" });
    expect(formData.has("entityId")).toBe(false);
    expect(buildFileUploadFormData({ file }).has("entityType")).toBe(false);
  });

  test("an actionForm upload names the screen and carries no entityType", () => {
    const formData = buildFileUploadFormData({
      file,
      actionForm: "rental:screen:upload-standard-layout",
      fieldName: "belege",
    });
    expect(formData.get("actionForm")).toBe("rental:screen:upload-standard-layout");
    expect(formData.get("fieldName")).toBe("belege");
    expect(formData.has("entityType")).toBe(false);
    expect(buildFileUploadFormData({ file }).has("actionForm")).toBe(false);
  });
});
