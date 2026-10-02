import { describe, expect, test } from "bun:test";
import { serializeError } from "../../errors/index.js";
import { publicIntakeRequiredError } from "../write-origin.js";

describe("publicIntakeRequiredError", () => {
  const origin = { rootHandler: "intake:write:submit", anonymousRoot: true, publicIntake: false };

  test("client-facing body names the root handler but not the table or columns", () => {
    const body = serializeError(
      publicIntakeRequiredError(origin, "read_secret_contacts", ["contact_email"]),
    );
    const wire = JSON.stringify(body);

    expect(body.error.details).toEqual({
      reason: "public_intake_required",
      rootHandler: "intake:write:submit",
    });
    expect(wire).not.toContain("read_secret_contacts");
    expect(wire).not.toContain("contact_email");
  });

  test("table and columns stay available to the server log via the cause", () => {
    const err = publicIntakeRequiredError(origin, "read_secret_contacts", ["contact_email"]);

    if (!(err.cause instanceof Error)) throw new Error("expected an Error cause");
    expect(err.cause.message).toContain("read_secret_contacts");
    expect(err.cause.message).toContain("contact_email");
  });

  test("a job origin is still named", () => {
    const err = publicIntakeRequiredError({ ...origin, viaJob: "intake:job:sync" }, "t", ["f"]);

    expect(err.message).toContain('via job "intake:job:sync"');
    expect(err.details).toMatchObject({ job: "intake:job:sync" });
  });
});
