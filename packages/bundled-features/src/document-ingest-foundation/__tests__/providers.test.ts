// r.bootCheck does NOT run inside setupTestStack, only createApp()'s
// validateBoot() — most boot-error assertions below call
// validateDocumentIngestProviderWiring directly; one drives real validateBoot().

import { describe, expect, test } from "bun:test";
import {
  defineFeature,
  type JobTrigger,
  type Registry,
  validateBoot,
} from "@cosmicdrift/kumiko-framework/engine";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { validateDocumentIngestProviderWiring } from "../boot-checks";
import { DOCUMENT_INGEST_REQUESTED_EVENT_QN } from "../events";
import { documentIngestFoundationFeature } from "../feature";
import {
  type DocumentIngestProviderOptions,
  documentIngestProviderTrigger,
  EXT_DOCUMENT_INGEST_PROVIDER,
  listIngestibleMimeTypes,
  resolveDocumentIngestProviders,
} from "../providers";

function makeProviderFeature(name: string, options: DocumentIngestProviderOptions) {
  return defineFeature(`test-provider-${name}`, (r) => {
    // requires() only matters to validateBoot's cross-feature checks — the
    // direct resolveDocumentIngestProviders/validateDocumentIngestProviderWiring
    // tests below never look at it.
    r.requires("document-ingest-foundation");
    r.useExtension(EXT_DOCUMENT_INGEST_PROVIDER, name, options);
  });
}

function makeConsumerFeature(jobName: string, trigger: JobTrigger) {
  return defineFeature(`test-consumer-${jobName}`, (r) => {
    r.job(jobName, { trigger, runIn: "worker" }, async () => {});
  });
}

describe("resolveDocumentIngestProviders", () => {
  test("resolves a single provider's mimeTypes to itself", () => {
    const feature = makeProviderFeature("alpha", {
      mimeTypes: ["application/pdf", "image/png"],
      maxFileBytes: 1000,
    });

    const resolved = resolveDocumentIngestProviders(feature.extensionUsages);

    expect(resolved.size).toBe(2);
    expect(resolved.get("application/pdf")).toEqual({ name: "alpha", maxFileBytes: 1000 });
    expect(resolved.get("image/png")).toEqual({ name: "alpha", maxFileBytes: 1000 });
  });

  test("two providers claiming the same mimeType throws", () => {
    const alpha = makeProviderFeature("alpha", {
      mimeTypes: ["application/pdf"],
      maxFileBytes: 1000,
    });
    const beta = makeProviderFeature("beta", {
      mimeTypes: ["application/pdf"],
      maxFileBytes: 2000,
    });

    expect(() =>
      resolveDocumentIngestProviders([...alpha.extensionUsages, ...beta.extensionUsages]),
    ).toThrow(/both claim mimeType "application\/pdf"/);
  });

  test("invalid options shape (bypassing the type system, e.g. a dynamic config) throws", () => {
    const feature = makeProviderFeature(
      "bad",
      // Missing maxFileBytes — only reachable by a caller that bypasses the
      // typed r.useExtension overload (e.g. hand-built dynamic config).
      { mimeTypes: ["application/pdf"] } as DocumentIngestProviderOptions,
    );

    expect(() => resolveDocumentIngestProviders(feature.extensionUsages)).toThrow(
      /registered invalid options/,
    );
  });
});

describe("listIngestibleMimeTypes", () => {
  test("returns every registered provider's mimeTypes, sorted", () => {
    const alpha = makeProviderFeature("alpha", {
      mimeTypes: ["image/png", "application/pdf"],
      maxFileBytes: 1000,
    });
    const beta = makeProviderFeature("beta", { mimeTypes: ["text/csv"], maxFileBytes: 500 });
    // Minimal test double — the function only calls getExtensionUsages.
    const registry = {
      getExtensionUsages: () => [...alpha.extensionUsages, ...beta.extensionUsages],
    } as unknown as Registry;

    expect(listIngestibleMimeTypes(registry)).toEqual(["application/pdf", "image/png", "text/csv"]);
  });
});

describe("documentIngestProviderTrigger", () => {
  test("builds the {on, where: {provider}} shape every provider job must use", () => {
    expect(documentIngestProviderTrigger("alpha")).toEqual({
      on: DOCUMENT_INGEST_REQUESTED_EVENT_QN,
      where: { provider: "alpha" },
    });
  });
});

describe("validateDocumentIngestProviderWiring", () => {
  test("zero providers, zero jobs — passes (uploads simply skip as unsupported-mime-type)", () => {
    expect(() => validateDocumentIngestProviderWiring([])).not.toThrow();
  });

  test("one provider with a matching wired job — passes", () => {
    const provider = makeProviderFeature("alpha", {
      mimeTypes: ["application/pdf"],
      maxFileBytes: 1000,
    });
    const consumer = makeConsumerFeature("process-alpha", documentIngestProviderTrigger("alpha"));

    expect(() => validateDocumentIngestProviderWiring([provider, consumer])).not.toThrow();
  });

  test("a job triggers on documentIngest.requested without a provider filter — throws", () => {
    const provider = makeProviderFeature("alpha", {
      mimeTypes: ["application/pdf"],
      maxFileBytes: 1000,
    });
    const consumer = makeConsumerFeature("process-anything", {
      on: DOCUMENT_INGEST_REQUESTED_EVENT_QN,
    });

    expect(() => validateDocumentIngestProviderWiring([provider, consumer])).toThrow(
      /without a provider filter/,
    );
  });

  test("a job's where.provider doesn't match any registered provider — throws", () => {
    const provider = makeProviderFeature("alpha", {
      mimeTypes: ["application/pdf"],
      maxFileBytes: 1000,
    });
    const consumer = makeConsumerFeature(
      "process-ghost",
      documentIngestProviderTrigger("ghost-provider"),
    );

    expect(() => validateDocumentIngestProviderWiring([provider, consumer])).toThrow(
      /filters documentIngest\.requested to provider "ghost-provider"/,
    );
  });

  test("a registered provider with no job wired to it — throws", () => {
    const provider = makeProviderFeature("alpha", {
      mimeTypes: ["application/pdf"],
      maxFileBytes: 1000,
    });

    expect(() => validateDocumentIngestProviderWiring([provider])).toThrow(
      /Provider "alpha" is registered.*but no job triggers/,
    );
  });
});

describe("validateBoot — proves the feature actually registers the bootCheck", () => {
  test("two providers colliding on a case-insensitive mimeType fail real boot, not just a direct validateDocumentIngestProviderWiring call", () => {
    const providerA = makeProviderFeature("provider-a", {
      mimeTypes: ["application/pdf"],
      maxFileBytes: 1000,
    });
    const providerAConsumer = makeConsumerFeature(
      "process-provider-a",
      documentIngestProviderTrigger("provider-a"),
    );
    const providerB = makeProviderFeature("provider-b", {
      // Same mimeType as provider-a modulo case — normalizeMimeType
      // lowercases both, so this must collide exactly like an exact-match would.
      mimeTypes: ["Application/PDF"],
      maxFileBytes: 1000,
    });
    const providerBConsumer = makeConsumerFeature(
      "process-provider-b",
      documentIngestProviderTrigger("provider-b"),
    );

    expect(() =>
      validateBoot([
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createTenantLifecycleFeature(),
        documentIngestFoundationFeature,
        providerA,
        providerAConsumer,
        providerB,
        providerBConsumer,
      ]),
    ).toThrow(
      /\[Feature document-ingest-foundation\] r\.bootCheck failed: .*both claim mimeType "application\/pdf"/,
    );
  });
});
