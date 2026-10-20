import { describe, expect, test } from "bun:test";
import { waitlistAdminNoticeTemplate, waitlistConfirmationTemplate } from "../mail.ts";

describe("waitlist mail templates", () => {
  test("the admin notice ships every locale the confirmation ships", () => {
    expect(Object.keys(waitlistAdminNoticeTemplate()).sort()).toEqual(
      Object.keys(waitlistConfirmationTemplate()).sort(),
    );
  });

  test("the Spanish admin notice is written in Spanish", () => {
    const es = waitlistAdminNoticeTemplate()["es"];
    expect(es?.meta?.subject).toBe("Nueva entrada en la lista de espera: {{name}}");
    expect(es?.body).toContain("Alguien acaba de unirse a la lista de espera.");
  });
});
