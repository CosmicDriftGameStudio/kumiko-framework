import * as z from "zod";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The bucket holds tenant files, so in production a remote endpoint must be
// https. Outside production plain http stays allowed, also for compose-network
// hostnames (minio, rustfs) that are not loopback.
function isAcceptableEndpoint(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.protocol === "https:") return true;
  return process.env["NODE_ENV"] !== "production" || LOOPBACK_HOSTNAMES.has(url.hostname);
}

/** S3-compatible endpoint URL: https, or http on a loopback host; any http host outside `NODE_ENV=production`. */
export const s3EndpointSchema = z
  .url({ protocol: /^https?$/ })
  .refine(isAcceptableEndpoint, "must use https unless the host is loopback");

/** Builds the env block `createS3ProviderFromEnv(prefix)` reads, e.g.
 *  `createS3EnvSchema({ prefix: "RELEASES_S3_" })` for a second bucket.
 *  Every field is optional: an app that mounts the env provider next to
 *  another one picks the provider at runtime, and the provider reports
 *  missing credentials on its first file operation. */
export function createS3EnvSchema<const TPrefix extends string>(options: {
  readonly prefix: TPrefix;
}) {
  const { prefix } = options;
  // @cast-boundary schema-walk — computed template keys widen to an index signature; the literal keys below are exactly the ones S3EnvShape names.
  const shape = {
    [`${prefix}BUCKET`]: z.string().min(1).optional().describe("S3 bucket."),
    [`${prefix}REGION`]: z.string().min(1).optional().describe("S3 region."),
    [`${prefix}ACCESS_KEY`]: z
      .string()
      .min(1)
      .optional()
      .describe("S3 access key id.")
      .meta({ kumiko: { pulumi: { secret: true } } }),
    [`${prefix}SECRET_KEY`]: z
      .string()
      .min(1)
      .optional()
      .describe("S3 secret access key.")
      .meta({ kumiko: { pulumi: { secret: true } } }),
    // An empty value (blank .env line) means "unset", same as the reader.
    [`${prefix}ENDPOINT`]: z
      .union([z.literal("").transform(() => undefined), s3EndpointSchema])
      .optional()
      .describe("S3-compatible endpoint (Hetzner, R2, MinIO). Default: AWS."),
    [`${prefix}FORCE_PATH_STYLE`]: z
      .enum(["true", "false"])
      .optional()
      .describe('Path-style bucket addressing ("true"), needed by MinIO and some S3 clones.'),
  } as S3EnvShape<TPrefix>;
  return z.object(shape);
}

type OptionalString = z.ZodOptional<z.ZodString>;

type S3EnvShape<TPrefix extends string> = {
  [Key in `${TPrefix}${"BUCKET" | "REGION" | "ACCESS_KEY" | "SECRET_KEY"}`]: OptionalString;
} & {
  [Key in `${TPrefix}ENDPOINT`]: z.ZodOptional<
    z.ZodUnion<
      [z.ZodPipe<z.ZodLiteral<"">, z.ZodTransform<undefined, "">>, typeof s3EndpointSchema]
    >
  >;
} & {
  [Key in `${TPrefix}FORCE_PATH_STYLE`]: z.ZodOptional<z.ZodEnum<{ true: "true"; false: "false" }>>;
};

/** The `S3_*` block of the `"s3-env"` provider. */
export const s3EnvSchema = createS3EnvSchema({ prefix: "S3_" });
