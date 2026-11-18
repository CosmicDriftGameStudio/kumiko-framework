import { describe, expect, test } from "bun:test";
import { withBootValidatorFixture } from "@cosmicdrift/kumiko-testing/helpers";
import type { FieldDefinition } from "@cosmicdrift/kumiko-types/fields";
import * as z from "zod";
import { buildEntityTable } from "../../../db/table-builder.ts";
import { validateBoot as validateBootRaw } from "../../boot-validator.ts";
import { defineFeature } from "../../define-feature.ts";
import {
  createEmbeddedField,
  createEntity,
  createFilesField,
  createTextField,
} from "../../factories.ts";
import type { FeatureDefinition } from "../../types/index.ts";

const title = () => createTextField({ personal: false, reason: "test_fixture" });

function readModelFeature(fields: Record<string, FieldDefinition>): FeatureDefinition {
  const entity = createEntity({
    name: "mail-view",
    table: "fw_read_model_field_access",
    fields: { title: title(), ...fields },
    access: { read: { User: "all" } },
  });
  return defineFeature("mailbox", (r) => {
    r.defineEvent("mail-received", z.object({}), { piiFields: "none" });
    r.projection({
      name: "mail-view",
      source: "mail-view",
      table: buildEntityTable(entity),
      entity,
      apply: { "mailbox:event:mail-received": async () => {} },
    });
  });
}

function validateBoot(feature: FeatureDefinition): void {
  validateBootRaw(withBootValidatorFixture([feature]));
}

// Read-model queries are hand-written and dispatch only filters fields of r.entity entities, so a
// field rule on a projection entity would be declared and never applied.
describe("field read rules on read-model entities", () => {
  test("a field with access.read fails the boot", () => {
    const feature = readModelFeature({
      note: createTextField({
        personal: false,
        reason: "test_fixture",
        access: { read: ["Admin"] },
      }),
    });
    expect(() => validateBoot(feature)).toThrow(
      /read-model entity "mail-view" field "note" has a read rule/,
    );
  });

  test("a writeOnly field fails the boot", () => {
    const feature = readModelFeature({
      token: createTextField({
        personal: false,
        reason: "test_fixture",
        writeOnly: true,
        sensitive: true,
      }),
    });
    expect(() => validateBoot(feature)).toThrow(
      /read-model entity "mail-view" field "token" has a read rule/,
    );
  });

  test("an embedded sub-field with access.read fails the boot", () => {
    const feature = readModelFeature({
      attachment: createEmbeddedField(
        { photos: { type: "files", access: { read: ["Admin"] } } },
        { personal: false, reason: "is_business_data" },
      ),
    });
    expect(() => validateBoot(feature)).toThrow(
      /read-model entity "mail-view" field "attachment" sub-field "photos" has a read rule/,
    );
  });

  test("a read model whose fields carry no read rule boots", () => {
    expect(() => validateBoot(readModelFeature({ files: createFilesField() }))).not.toThrow();
  });
});

const restrictedNote = () =>
  createTextField({ personal: false, reason: "test_fixture", access: { read: ["Admin"] } });

function projectionEntity(name: string, fields: Record<string, FieldDefinition>) {
  return createEntity({
    name,
    table: `fw_read_model_field_access_${name.replaceAll("-", "_")}`,
    fields: { title: title(), ...fields },
  });
}

// Only the r.entity of a projection's own source is filtered by dispatch; every other entity a
// projection carries comes back from hand-written queries, whatever its source looks like.
describe("field read rules on other projection entities", () => {
  test("a projection fed by several streams fails the boot", () => {
    const entity = projectionEntity("mail-digest", { note: restrictedNote() });
    const feature = defineFeature("mailbox", (r) => {
      r.defineEvent("mail-received", z.object({}), { piiFields: "none" });
      r.projection({
        name: "mail-digest",
        source: ["mail-a", "mail-b"],
        table: buildEntityTable(entity),
        entity,
        apply: { "mailbox:event:mail-received": async () => {} },
      });
    });
    expect(() => validateBoot(feature)).toThrow(
      /read-model entity "mail-digest" field "note" has a read rule.*projection "mail-digest"/,
    );
  });

  test("a separate entity on a projection of the feature's own r.entity fails the boot", () => {
    const ticket = projectionEntity("ticket", {});
    const summary = projectionEntity("ticket-summary", { note: restrictedNote() });
    const feature = defineFeature("helpdesk", (r) => {
      r.entity(ticket);
      r.projection({
        name: "ticket-summary",
        source: "ticket",
        table: buildEntityTable(summary),
        entity: summary,
        apply: { "ticket.created": async () => {} },
      });
    });
    expect(() => validateBoot(feature)).toThrow(
      /read-model entity "ticket-summary" field "note" has a read rule/,
    );
  });

  test("a projection over another feature's r.entity names its own entity", () => {
    const ticket = projectionEntity("ticket", {});
    const report = projectionEntity("ticket-report", { note: restrictedNote() });
    const helpdesk = defineFeature("helpdesk", (r) => {
      r.entity(ticket);
    });
    const reporting = defineFeature("reporting", (r) => {
      r.projection({
        name: "ticket-report",
        source: "ticket",
        table: buildEntityTable(report),
        entity: report,
        apply: { "ticket.created": async () => {} },
      });
    });
    expect(() => validateBootRaw(withBootValidatorFixture([helpdesk, reporting]))).toThrow(
      /\[Feature reporting\] read-model entity "ticket-report" field "note" has a read rule/,
    );
  });

  test("a projection that carries its own source's r.entity boots", () => {
    const ticket = projectionEntity("ticket", { note: restrictedNote() });
    const feature = defineFeature("helpdesk", (r) => {
      r.entity(ticket);
      r.projection({
        name: "ticket-copy",
        source: "ticket",
        table: buildEntityTable(ticket),
        entity: ticket,
        apply: { "ticket.created": async () => {} },
      });
    });
    expect(() => validateBoot(feature)).not.toThrow();
  });
});
