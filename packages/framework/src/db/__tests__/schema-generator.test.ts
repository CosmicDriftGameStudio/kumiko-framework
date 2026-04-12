import { describe, expect, test } from "vitest";
import {
  createBooleanField,
  createDateField,
  createEntity,
  createNumberField,
  createSelectField,
  createTextField,
  defineFeature,
} from "../../engine";
import { generateSchemaSource } from "../schema-generator";

describe("generateSchemaSource", () => {
  test("generates empty output for features without entities", () => {
    const feature = defineFeature("empty", () => {});
    const output = generateSchemaSource([feature]);
    expect(output).toContain("no entities found");
  });

  test("generates CREATE TABLE for a simple entity", () => {
    const feature = defineFeature("blog", (r) => {
      r.entity(
        "post",
        createEntity({
          table: "posts",
          fields: {
            title: createTextField({ required: true }),
            body: createTextField(),
          },
        }),
      );
    });

    const output = generateSchemaSource([feature]);

    // Import check
    expect(output).toContain('from "drizzle-orm/pg-core"');
    expect(output).toContain("integer");
    expect(output).toContain("pgTable");
    expect(output).toContain("serial");
    expect(output).toContain("text");
    expect(output).toContain("timestamp");

    // Table definition
    expect(output).toContain('export const postTable = pgTable("posts"');

    // Base columns
    expect(output).toContain('id: serial("id").primaryKey()');
    expect(output).toContain('tenantId: integer("tenant_id").notNull()');
    expect(output).toContain('version: integer("version").default(1).notNull()');
    expect(output).toContain('insertedAt: timestamp("inserted_at").defaultNow().notNull()');
    expect(output).toContain('modifiedAt: timestamp("modified_at")');
    expect(output).toContain('insertedById: integer("inserted_by_id")');
    expect(output).toContain('modifiedById: integer("modified_by_id")');

    // Entity fields
    expect(output).toContain('title: text("title")');
    expect(output).toContain('body: text("body")');

    // No soft delete columns
    expect(output).not.toContain("isDeleted");
    expect(output).not.toContain("deletedAt");
  });

  test("includes soft delete columns when enabled", () => {
    const feature = defineFeature("hr", (r) => {
      r.entity(
        "employee",
        createEntity({
          table: "employees",
          fields: { name: createTextField() },
          softDelete: true,
        }),
      );
    });

    const output = generateSchemaSource([feature]);

    expect(output).toContain('isDeleted: boolean("is_deleted").default(false).notNull()');
    expect(output).toContain('deletedAt: timestamp("deleted_at")');
    expect(output).toContain('deletedById: integer("deleted_by_id")');
  });

  test("maps all field types correctly", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "item",
        createEntity({
          table: "items",
          fields: {
            label: createTextField(),
            count: createNumberField(),
            isActive: createBooleanField({ default: true }),
            isOptional: createBooleanField(),
            status: createSelectField({ options: ["draft", "published"] }),
            createdOn: createDateField(),
          },
        }),
      );
    });

    const output = generateSchemaSource([feature]);

    expect(output).toContain('label: text("label")');
    expect(output).toContain('count: integer("count")');
    expect(output).toContain('isActive: boolean("is_active").default(true).notNull()');
    expect(output).toContain('isOptional: boolean("is_optional")');
    expect(output).toContain('status: text("status")'); // select → text
    expect(output).toContain('createdOn: timestamp("created_on")');
  });

  test("handles file/image fields", () => {
    const feature = defineFeature("media", (r) => {
      r.entity(
        "asset",
        createEntity({
          table: "assets",
          fields: {
            thumbnail: { type: "image", maxSize: "5mb" },
            document: { type: "file" },
            gallery: { type: "images", maxCount: 10 },
            attachments: { type: "files", maxCount: 5 },
          },
        }),
      );
    });

    const output = generateSchemaSource([feature]);

    // Single file/image → integer column (fileRefId)
    expect(output).toContain('thumbnail: integer("thumbnail")');
    expect(output).toContain('document: integer("document")');

    // Multi file/image → no column (resolved via FileRef table)
    expect(output).not.toContain("gallery");
    expect(output).not.toContain("attachments");
  });

  test("handles multiple features with multiple entities", () => {
    const blogFeature = defineFeature("blog", (r) => {
      r.entity("post", createEntity({ table: "posts", fields: { title: createTextField() } }));
      r.entity(
        "comment",
        createEntity({ table: "comments", fields: { body: createTextField() }, softDelete: true }),
      );
    });

    const hrFeature = defineFeature("hr", (r) => {
      r.entity(
        "employee",
        createEntity({ table: "employees", fields: { name: createTextField() } }),
      );
    });

    const output = generateSchemaSource([blogFeature, hrFeature]);

    // All three tables present
    expect(output).toContain('export const postTable = pgTable("posts"');
    expect(output).toContain('export const commentTable = pgTable("comments"');
    expect(output).toContain('export const employeeTable = pgTable("employees"');

    // Feature annotations
    expect(output).toContain("// Entity: post (feature: blog)");
    expect(output).toContain("// Entity: comment (feature: blog)");
    expect(output).toContain("// Entity: employee (feature: hr)");

    // Only comment has soft delete
    const commentSection = output.slice(
      output.indexOf("// Entity: comment"),
      output.indexOf("// Entity: employee"),
    );
    expect(commentSection).toContain("isDeleted");

    const employeeSection = output.slice(output.indexOf("// Entity: employee"));
    expect(employeeSection).not.toContain("isDeleted");
  });

  test("converts camelCase field names to snake_case column names", () => {
    const feature = defineFeature("test", (r) => {
      r.entity(
        "record",
        createEntity({
          table: "records",
          fields: {
            firstName: createTextField(),
            lastModifiedDate: createDateField(),
            isEmailVerified: createBooleanField(),
          },
        }),
      );
    });

    const output = generateSchemaSource([feature]);

    expect(output).toContain('firstName: text("first_name")');
    expect(output).toContain('lastModifiedDate: timestamp("last_modified_date")');
    expect(output).toContain('isEmailVerified: boolean("is_email_verified")');
  });

  test("generated output is valid TypeScript (no framework imports)", () => {
    const feature = defineFeature("app", (r) => {
      r.entity(
        "user",
        createEntity({
          table: "users",
          fields: {
            email: createTextField({ required: true, searchable: true }),
            isEnabled: createBooleanField({ default: true }),
          },
          softDelete: true,
        }),
      );
    });

    const output = generateSchemaSource([feature]);

    // Only drizzle-orm import, no framework imports
    const importLines = output.split("\n").filter((l) => l.startsWith("import"));
    expect(importLines).toHaveLength(1);
    expect(importLines[0]).toContain("drizzle-orm/pg-core");

    // No framework references
    expect(output).not.toContain("@kumiko");
    expect(output).not.toContain("../engine");
    expect(output).not.toContain("buildDrizzleTable");
  });

  test("includes DO NOT EDIT header", () => {
    const feature = defineFeature("app", (r) => {
      r.entity("item", createEntity({ table: "items", fields: { name: createTextField() } }));
    });

    const output = generateSchemaSource([feature]);

    expect(output).toContain("Auto-generated by kumiko");
    expect(output).toContain("DO NOT EDIT");
    expect(output).toContain("yarn kumiko migrate generate-schema");
  });
});
