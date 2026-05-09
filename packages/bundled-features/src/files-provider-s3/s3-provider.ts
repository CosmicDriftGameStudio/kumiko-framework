import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import type { FileStorageProvider, SignedUrlOptions } from "@cosmicdrift/kumiko-framework/files";

// =============================================================================
// Operator-Pflicht-Setup (Multipart-Upload-Cleanup)
// =============================================================================
//
// `writeStream` nutzt @aws-sdk/lib-storage's Upload-class fuer echtes
// multipart-streaming. S3 created dabei eine Multipart-Upload-Session mit
// einer Upload-ID; bei normaler Completion wird sie via Complete-
// MultipartUpload geschlossen.
//
// **Edge-Case bei Worker-Abort:** wenn der Export-Worker mid-write gecancelt
// wird (Pod-Restart, K8s-OOM-Kill, Process-Signal), bleibt die Multipart-
// Upload-Session in S3 OFFEN. S3 behaelt die bereits hochgeladenen Parts
// und berechnet Storage-Kosten dafuer — bis sie manuell oder via Lifecycle-
// Rule abgebrochen werden.
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
//
// **Code-side abort()** fuer graceful Worker-Shutdown ist follow-up. Das
// braucht Worker-Cancel-Semantik (AbortSignal-Propagation durch r.job),
// die im framework noch nicht existiert. Bis dahin ist die Lifecycle-
// Rule die einzige Garantie gegen Storage-Leakage.

// Minimal config surface — everything the SDK needs, nothing framework-
// specific. Apps wire this into `buildServer({ files: { storageProvider } })`
// the same way they'd pass createLocalProvider in dev.
//
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
// silently if the virtual-host-style is picked. Keeping it testable
// without constructing an S3Client means the rule stays honest.
export function resolveForcePathStyle(config: S3ProviderConfig): boolean {
  // Explicit override wins; otherwise: custom endpoint → path-style
  // (that's the shape every non-AWS S3-compatible provider expects),
  // no endpoint → AWS default virtual-host-style.
  return config.forcePathStyle ?? config.endpoint !== undefined;
}

export function createS3Provider(config: S3ProviderConfig): FileStorageProvider {
  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint !== undefined && { endpoint: config.endpoint }),
    forcePathStyle: resolveForcePathStyle(config),
  });

  return {
    async write(key, data, mimeType): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: data,
          ...(mimeType !== undefined && { ContentType: mimeType }),
        }),
      );
    },

    async writeStream(key, source, options): Promise<void> {
      // Echtes multipart-streaming via @aws-sdk/lib-storage.Upload —
      // der Source-AsyncIterable wird chunk-weise zu S3 hochgeladen,
      // niemals alles im Memory aggregiert. lib-storage handled
      // automatisch chunking (5MB-Parts default), parallel-uploads
      // (4 concurrent default), und retry bei Part-Failures.
      //
      // Memory-Footprint: ~5MB pro in-flight-part × 4 concurrent =
      // ~20MB Heap-Bound, unabhaengig von der Total-Bundle-Size. Macht
      // 1GB+ Bundles moeglich ohne OOM.
      //
      // Readable.from(source) adapiert AsyncIterable → node:Readable —
      // lib-storage's Body-Type akzeptiert Web-ReadableStream + node-
      // Readable, nicht direkt AsyncIterable. Adapter ist zero-copy.
      const body = Readable.from(source);
      const upload = new Upload({
        client,
        params: {
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ...(options?.mimeType !== undefined && { ContentType: options.mimeType }),
        },
      });
      await upload.done();
    },

    async read(key): Promise<Uint8Array> {
      const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      if (!response.Body) {
        throw new Error(`s3_read_empty_body: ${key}`);
      }
      // transformToByteArray is the stream-to-bytes helper the v3 SDK ships
      // with — avoids us reinventing a ReadableStream reader. Returns a
      // Uint8Array, which is what FileStorageProvider.read() promises.
      return response.Body.transformToByteArray();
    },

    readStream(key): AsyncIterable<Uint8Array> {
      // S3 GetObject.Body ist ein StreamingBlobPayloadOutputTypes — auf
      // node ist das ein Readable-Stream der bereits AsyncIterable<Buffer>
      // ist. Wir wrappen lazy: erst beim ersten chunk-pull wird der
      // GetObject-Request abgesetzt. Wenn der Key nicht existiert, faellt
      // der Error genau dort (nicht beim readStream-Aufruf) — gleiches
      // Lazy-Verhalten wie inmemory + local.
      return {
        async *[Symbol.asyncIterator]() {
          const response = await client.send(
            new GetObjectCommand({ Bucket: config.bucket, Key: key }),
          );
          if (!response.Body) {
            throw new Error(`s3_read_empty_body: ${key}`);
          }
          // SdkStream is AsyncIterable<Buffer> on node. Buffer extends
          // Uint8Array; cast sichert die Surface ohne neue runtime-deps.
          const body = response.Body as AsyncIterable<Uint8Array>;
          for await (const chunk of body) {
            yield chunk;
          }
        },
      };
    },

    async delete(key): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },

    async exists(key): Promise<boolean> {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return true;
      } catch (error) {
        // S3 SDK throws either NotFound or a generic 404. Check both the
        // `.name` property (newer SDKs) and the `$metadata.httpStatusCode`
        // (what the SDK guarantees on every error).
        const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw error;
      }
    },

    async getSignedUrl(
      key: string,
      expiresInSeconds: number,
      options?: SignedUrlOptions,
    ): Promise<string> {
      // ResponseContentDisposition is the S3 mechanism for overriding the
      // Content-Disposition header on the presigned GET — the browser sees
      // the original filename instead of the UUID storage key.
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ...(options?.contentDisposition !== undefined && {
          ResponseContentDisposition: options.contentDisposition,
        }),
      });
      return presign(client, command, { expiresIn: expiresInSeconds });
    },
  };
}
