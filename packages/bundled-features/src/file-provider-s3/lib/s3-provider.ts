import {
  assertSafeStorageKey,
  type FileStorageProvider,
  type SignedUrlOptions,
} from "@cosmicdrift/kumiko-framework/files";

// =============================================================================
// Required operator setup (multipart-upload cleanup)
// =============================================================================
//
// `writeStream` uses Bun's S3 writer for real multipart streaming. S3
// creates a multipart-upload session with an upload ID for it; on normal
// completion the session is closed. If the export worker is cancelled
// mid-write (pod restart, K8s OOM kill, process signal), the session stays
// OPEN in S3 and bills storage for the parts already uploaded — until a
// lifecycle rule aborts it.
//
// **Required operator setup on every bucket:**
//
//   {
//     "Rules": [{
//       "ID": "AbortIncompleteMultipartUploads",
//       "Status": "Enabled",
//       "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 },
//       "Filter": {}
//     }]
//   }
//
// AWS CLI: `aws s3api put-bucket-lifecycle-configuration --bucket <name>
// --lifecycle-configuration file://lifecycle.json`. Hetzner Object Storage,
// R2 and Minio support the same syntax.
//
// =============================================================================
// Required operator setup (IAM: list permission)
// =============================================================================
//
// GDPR-forget/tenant-destroy erasure (user-data-rights-defaults) calls
// `list()` to find derivative/variant keys alongside the original. A bucket
// policy granting only `s3:DeleteObject` (no `s3:ListBucket`) makes every
// forget run fail — grant both, not just delete.

const STREAM_PART_SIZE = 5 * 1024 * 1024;

// `endpoint` + `forcePathStyle` are the R2/Minio knobs: AWS-S3 uses
// virtual-host-style URLs (bucket.s3.region.amazonaws.com), Minio and many
// S3-compat providers need path-style (endpoint/bucket/key). Default
// forcePathStyle=true whenever a custom endpoint is set — that's the
// expected shape for every non-AWS provider.
export type S3ProviderConfig = {
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  // Custom endpoint for R2/Minio/DigitalOcean Spaces/etc. Omit for AWS S3.
  readonly endpoint?: string;
  // Override auto-detection; mainly for explicit Minio-style tests.
  readonly forcePathStyle?: boolean;
};

// A single S3 list() page, generalized just enough that collectPaginatedKeys
// can be tested against a fake sequence of pages, no live bucket needed.
type S3ListPage = {
  readonly contents?: ReadonlyArray<{ readonly key: string }>;
  readonly isTruncated?: boolean;
};

// Exported for unit testing — the loop is the load-bearing part of `list`:
// S3 caps a page at 1000 keys, and a derivative set for a heavily-rendered
// original can exceed that. Owns only the isTruncated/startAfter pagination;
// `fetchPage` closes over prefix/maxKeys/credentials.
export async function collectPaginatedKeys(
  fetchPage: (startAfter: string | undefined) => Promise<S3ListPage>,
): Promise<readonly string[]> {
  const keys: string[] = [];
  let startAfter: string | undefined;
  for (;;) {
    const page = await fetchPage(startAfter);
    const contents = page.contents ?? [];
    for (const obj of contents) keys.push(obj.key);
    if (!page.isTruncated || contents.length === 0) break;
    startAfter = contents[contents.length - 1]?.key;
  }
  return keys;
}

// Exported for unit testing — the branch logic (explicit override vs.
// auto-detect from endpoint) is small but load-bearing: Minio/R2 break
// silently if the virtual-host-style is picked.
export function resolveForcePathStyle(config: S3ProviderConfig): boolean {
  // Explicit override wins; otherwise: custom endpoint → path-style
  // (that's the shape every non-AWS S3-compatible provider expects),
  // no endpoint → AWS default virtual-host-style.
  return config.forcePathStyle ?? config.endpoint !== undefined;
}

// Bun's `virtualHostedStyle` is the strict inverse of the `forcePathStyle` knob
// this config exposes — the seam that silently breaks Minio/R2 if the `!` drifts.
export function resolveVirtualHostedStyle(config: S3ProviderConfig): boolean {
  return !resolveForcePathStyle(config);
}

export function createS3Provider(config: S3ProviderConfig): FileStorageProvider {
  const client = new Bun.S3Client({
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    ...(config.endpoint !== undefined && { endpoint: config.endpoint }),
    virtualHostedStyle: resolveVirtualHostedStyle(config),
  });

  return {
    async write(key, data, mimeType): Promise<void> {
      assertSafeStorageKey(key);
      await client.write(key, data, mimeType !== undefined ? { type: mimeType } : undefined);
    },

    async writeStream(key, source, options): Promise<void> {
      assertSafeStorageKey(key);
      // Real multipart streaming via Bun's S3 writer — partSize controls the
      // part boundary internally (AWS/R2 require non-final parts >= 5 MiB,
      // otherwise EntityTooSmall on CompleteMultipartUpload). A manual flush()
      // here would break exactly that guarantee as soon as the source chunks
      // do not line up with partSize.
      const writer = client.file(key).writer({
        ...(options?.mimeType !== undefined && { type: options.mimeType }),
        retry: 3,
        queueSize: 4,
        partSize: STREAM_PART_SIZE,
      });
      for await (const chunk of source) {
        // Await applies backpressure and bounds the in-flight queue to
        // queueSize instead of buffering without limit.
        await writer.write(chunk);
      }
      await writer.end();
    },

    async read(key): Promise<Uint8Array> {
      assertSafeStorageKey(key);
      return new Uint8Array(await client.file(key).arrayBuffer());
    },

    readStream(key): AsyncIterable<Uint8Array> {
      assertSafeStorageKey(key);
      // Lazy: the GET request is only sent on the first chunk pull. If the key
      // does not exist, the error surfaces right there (not on the readStream
      // call) — same lazy behavior as inmemory + local.
      return {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of client.file(key).stream()) {
            yield chunk;
          }
        },
      };
    },

    async delete(key): Promise<void> {
      assertSafeStorageKey(key);
      await client.delete(key);
    },

    async exists(key): Promise<boolean> {
      assertSafeStorageKey(key);
      return client.exists(key);
    },

    async list(prefix): Promise<readonly string[]> {
      return collectPaginatedKeys((startAfter) =>
        client.list({
          prefix,
          maxKeys: 1000,
          ...(startAfter !== undefined && { startAfter }),
        }),
      );
    },

    async getSignedUrl(
      key: string,
      expiresInSeconds: number,
      options?: SignedUrlOptions,
    ): Promise<string> {
      assertSafeStorageKey(key);
      // Bun signs contentDisposition as the response-content-disposition
      // query parameter (a response override for the GET download) —
      // the browser sees the original filename instead of the UUID key.
      return client.presign(key, {
        expiresIn: expiresInSeconds,
        method: "GET",
        ...(options?.contentDisposition !== undefined && {
          contentDisposition: options.contentDisposition,
        }),
      });
    },
  };
}
