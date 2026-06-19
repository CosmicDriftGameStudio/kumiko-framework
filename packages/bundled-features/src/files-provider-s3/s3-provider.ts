import type { FileStorageProvider, SignedUrlOptions } from "@cosmicdrift/kumiko-framework/files";

// =============================================================================
// Operator-Pflicht-Setup (Multipart-Upload-Cleanup)
// =============================================================================
//
// `writeStream` nutzt Bun's S3-Writer fuer echtes multipart-streaming. S3
// created dabei eine Multipart-Upload-Session mit einer Upload-ID; bei
// normaler Completion wird sie geschlossen. Wird der Export-Worker mid-write
// gecancelt (Pod-Restart, K8s-OOM-Kill, Process-Signal), bleibt die Session
// in S3 OFFEN und berechnet Storage-Kosten fuer die bereits hochgeladenen
// Parts — bis sie via Lifecycle-Rule abgebrochen werden.
//
// **Pflicht-Operator-Setup auf jedem Bucket:**
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
// AWS-CLI: `aws s3api put-bucket-lifecycle-configuration --bucket <name>
// --lifecycle-configuration file://lifecycle.json`. Hetzner Object Storage
// + R2 + Minio supporten dieselbe Syntax.

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

// Exported for unit testing — the branch logic (explicit override vs.
// auto-detect from endpoint) is small but load-bearing: Minio/R2 break
// silently if the virtual-host-style is picked.
export function resolveForcePathStyle(config: S3ProviderConfig): boolean {
  // Explicit override wins; otherwise: custom endpoint → path-style
  // (that's the shape every non-AWS S3-compatible provider expects),
  // no endpoint → AWS default virtual-host-style.
  return config.forcePathStyle ?? config.endpoint !== undefined;
}

// Bun's `virtualHostedStyle` is the inverse of the AWS-SDK `forcePathStyle`
// knob this config exposes: path-style ⇔ virtualHostedStyle=false. Exported +
// tested alongside resolveForcePathStyle because the inversion is exactly the
// seam that silently breaks Minio/R2 if the `!` ever drifts.
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
      await client.write(key, data, mimeType !== undefined ? { type: mimeType } : undefined);
    },

    async writeStream(key, source, options): Promise<void> {
      // Echtes multipart-streaming via Bun's S3-Writer — partSize steuert die
      // Part-Boundary intern (AWS/R2 verlangen non-final Parts >= 5 MiB,
      // sonst EntityTooSmall beim CompleteMultipartUpload). Manuelles flush()
      // hier wuerde genau diese Garantie brechen, sobald die Source-Chunks
      // nicht auf partSize aufgehen.
      const writer = client.file(key).writer({
        ...(options?.mimeType !== undefined && { type: options.mimeType }),
        retry: 3,
        queueSize: 4,
        partSize: STREAM_PART_SIZE,
      });
      for await (const chunk of source) {
        // Await applies Backpressure und bounded die in-flight Queue auf
        // queueSize, statt unbegrenzt zu puffern.
        await writer.write(chunk);
      }
      await writer.end();
    },

    async read(key): Promise<Uint8Array> {
      return new Uint8Array(await client.file(key).arrayBuffer());
    },

    readStream(key): AsyncIterable<Uint8Array> {
      // Lazy: erst beim ersten chunk-pull wird der GET-Request abgesetzt.
      // Existiert der Key nicht, faellt der Error genau dort (nicht beim
      // readStream-Aufruf) — gleiches Lazy-Verhalten wie inmemory + local.
      return {
        async *[Symbol.asyncIterator]() {
          for await (const chunk of client.file(key).stream()) {
            yield chunk;
          }
        },
      };
    },

    async delete(key): Promise<void> {
      await client.delete(key);
    },

    async exists(key): Promise<boolean> {
      return client.exists(key);
    },

    async getSignedUrl(
      key: string,
      expiresInSeconds: number,
      options?: SignedUrlOptions,
    ): Promise<string> {
      // contentDisposition wird von Bun als response-content-disposition
      // Query-Param signiert (Response-Override fuer den GET-Download) —
      // der Browser sieht den Original-Dateinamen statt des UUID-Keys.
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
