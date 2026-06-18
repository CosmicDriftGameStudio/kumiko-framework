// Test-only helpers for template-resolver consumers. Import via
// `@cosmicdrift/kumiko-bundled-features/template-resolver/testing`.
// No bun:test here — callers register cases with their own test runner.

import { insertOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import type { ResolveRequest, TemplateResource } from "./api";
import { TemplateNotFoundError } from "./api";
import {
  type ContentFormat,
  FALLBACK_LOCALE,
  type RenderKind,
  SYSTEM_TENANT_ID,
  type TemplateScope,
  type TemplateStatus,
} from "./constants";
import { templateResourcesTable } from "./table";

export type TemplateConsumer = {
  readonly resolve: (args: ResolveRequest) => Promise<TemplateResource>;
  readonly resolveResources?: (template: TemplateResource) => Promise<Record<string, string>>;
};

export type TemplateConsumerConformanceOptions = {
  readonly getDb: () => DbConnection;
  readonly tenantId: string;
};

export type ConformanceTestRegistrar = (name: string, fn: () => Promise<void>) => void;

export class ConformanceAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConformanceAssertionError";
  }
}

type SeedTemplateArgs = {
  tenantId: string;
  slug: string;
  kind: RenderKind;
  locale: string;
  scope: TemplateScope;
  status?: TemplateStatus;
  content?: string;
  contentFormat?: ContentFormat;
  variableSchema?: Record<string, unknown>;
  linkedResources?: Record<string, string>;
  parentTemplateId?: string;
};

async function seedTemplate(db: DbConnection, args: SeedTemplateArgs): Promise<void> {
  await insertOne(db, templateResourcesTable, {
    tenantId: args.tenantId,
    slug: args.slug,
    kind: args.kind,
    locale: args.locale,
    scope: args.scope,
    status: args.status ?? "active",
    content: args.content ?? `content for ${args.slug} (${args.locale})`,
    contentFormat: args.contentFormat ?? "markdown",
    variableSchema: JSON.stringify(args.variableSchema ?? {}),
    linkedResources: JSON.stringify(args.linkedResources ?? {}),
    parentTemplateId: args.parentTemplateId ?? null,
    createdBy: "conformance",
    updatedBy: "conformance",
  });
}

export async function assertConsumerHandlesNotFound(
  consumer: TemplateConsumer,
  opts: TemplateConsumerConformanceOptions,
): Promise<void> {
  const { tenantId } = opts;
  let rejected = false;
  let err: unknown;
  try {
    await consumer.resolve({
      tenantId,
      slug: "conformance-not-found-slug",
      kind: "mail-html",
      locale: "de",
    });
  } catch (e) {
    rejected = true;
    err = e;
  }
  if (!rejected) {
    throw new ConformanceAssertionError("expected resolve to reject with TemplateNotFoundError");
  }
  if (!(err instanceof TemplateNotFoundError)) {
    const label = err instanceof Error ? err.constructor.name : typeof err;
    throw new ConformanceAssertionError(`expected TemplateNotFoundError, received ${label}`);
  }
}

export async function assertConsumerRespectsLocaleFallback(
  consumer: TemplateConsumer,
  opts: TemplateConsumerConformanceOptions,
): Promise<void> {
  const db = opts.getDb();
  const { tenantId } = opts;
  const slug = `conformance-fallback-${crypto.randomUUID()}`;
  await seedTemplate(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug,
    kind: "notification",
    locale: FALLBACK_LOCALE,
    scope: "system",
    content: "conformance-fallback-content",
  });
  const result = await consumer.resolve({
    tenantId,
    slug,
    kind: "notification",
    locale: "tr",
  });
  if (result.locale !== FALLBACK_LOCALE) {
    throw new ConformanceAssertionError(
      `expected locale ${FALLBACK_LOCALE}, received ${result.locale}`,
    );
  }
  if (result.content !== "conformance-fallback-content") {
    throw new ConformanceAssertionError(`expected fallback content, received ${result.content}`);
  }
}

export async function assertConsumerHandlesMissingResourceKeys(
  consumer: TemplateConsumer,
  opts: TemplateConsumerConformanceOptions,
): Promise<void> {
  const resolveResources = consumer.resolveResources;
  if (!resolveResources) {
    throw new ConformanceAssertionError(
      "assertConsumerHandlesMissingResourceKeys requires consumer.resolveResources",
    );
  }

  const db = opts.getDb();
  const { tenantId } = opts;
  const slug = `conformance-resources-${crypto.randomUUID()}`;
  await seedTemplate(db, {
    tenantId: SYSTEM_TENANT_ID,
    slug,
    kind: "mail-html",
    locale: "de",
    scope: "system",
    linkedResources: { logo: "file_missing" },
  });
  const template = await consumer.resolve({
    tenantId,
    slug,
    kind: "mail-html",
    locale: "de",
  });

  try {
    const resources = await resolveResources(template);
    if (resources === undefined) {
      throw new ConformanceAssertionError("resolveResources returned undefined");
    }
  } catch (err) {
    if (err instanceof ConformanceAssertionError) throw err;
    if (!(err instanceof Error)) {
      throw new ConformanceAssertionError(`resolveResources threw non-Error: ${typeof err}`);
    }
    if (err instanceof TypeError) {
      throw new ConformanceAssertionError(
        `resolveResources threw TypeError (unhandled missing key?): ${err.message}`,
      );
    }
  }
}

/** Register conformance cases with the caller's test runner (e.g. bun `test`). */
export function runTemplateConsumerConformance(
  register: ConformanceTestRegistrar,
  consumer: TemplateConsumer,
  opts: TemplateConsumerConformanceOptions,
): void {
  register("consumer handles TemplateNotFoundError gracefully", () =>
    assertConsumerHandlesNotFound(consumer, opts),
  );
  register("consumer respects locale-fallback", () =>
    assertConsumerRespectsLocaleFallback(consumer, opts),
  );
  if (consumer.resolveResources) {
    register("consumer handles missing resource keys", () =>
      assertConsumerHandlesMissingResourceKeys(consumer, opts),
    );
  }
}
