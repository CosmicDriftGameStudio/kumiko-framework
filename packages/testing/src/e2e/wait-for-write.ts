import { expect, type Page, type Response } from "@playwright/test";

function hasWriteType(body: unknown, writeType: string): boolean {
  return typeof body === "object" && body !== null && "type" in body && body.type === writeType;
}

// A rejected write (tier gate, validation, CSRF) fails here with the response body
// instead of a later visibility timeout.
export function waitForWrite(page: Page, writeType: string): Promise<Response> {
  return page
    .waitForResponse(
      (response) =>
        response.url().includes("/api/write") &&
        hasWriteType(response.request().postDataJSON(), writeType),
    )
    .then(async (response) => {
      expect(response.status(), await response.text()).toBeLessThan(400);
      return response;
    });
}
