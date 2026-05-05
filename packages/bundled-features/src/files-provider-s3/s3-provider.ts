import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import type { FileStorageProvider, SignedUrlOptions } from "@cosmicdrift/kumiko-framework/files";

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
