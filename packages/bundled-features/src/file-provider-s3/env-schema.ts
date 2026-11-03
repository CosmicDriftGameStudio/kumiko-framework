import * as z from "zod";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The bucket holds tenant files, so in production a remote endpoint must be
 *  https. Outside production plain http stays allowed, also for compose-network
 *  hostnames (minio, rustfs) that are not loopback. `isProduction` comes from the
 *  env being booted: a field schema cannot see sibling vars, so the endpoint
 *  variables carry it as an env rule and the env readers apply it again. */
export function isAcceptableS3Endpoint(value: string, isProduction: boolean): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.protocol === "https:") return true;
  return !isProduction || LOOPBACK_HOSTNAMES.has(url.hostname);
}

const ENDPOINT_RULE_MESSAGE = "must use https unless the host is loopback (NODE_ENV=production)";

/** Env rule for the endpoint variables: the production flag comes from the env being booted. */
export function s3EndpointEnvRule(
  value: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  return isAcceptableS3Endpoint(value, env["NODE_ENV"] === "production")
    ? undefined
    : ENDPOINT_RULE_MESSAGE;
}

/** S3-compatible endpoint URL (http or https); the production https rule is `isAcceptableS3Endpoint`. */
export const s3EndpointSchema = z.url({ protocol: /^https?$/ });

function buildS3Shape(prefix: string) {
  return {
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
      .describe("S3-compatible endpoint (Hetzner, R2, MinIO). Default: AWS.")
      .meta({ kumiko: { envRule: s3EndpointEnvRule } }),
    [`${prefix}FORCE_PATH_STYLE`]: z
      .enum(["true", "false"])
      .optional()
      .describe('Path-style bucket addressing ("true"), needed by MinIO and some S3 clones.'),
  };
}

/** Builds the env block `createS3ProviderFromEnv(prefix)` reads, e.g.
 *  `createS3EnvSchema({ prefix: "RELEASES_S3_" })` for a second bucket.
 *  Every field is optional: an app that mounts the env provider next to
 *  another one picks the provider at runtime, and the provider reports
 *  missing credentials on its first file operation. */
export function createS3EnvSchema<const TPrefix extends string>(options: {
  readonly prefix: TPrefix;
}) {
  // @cast-boundary schema-walk — computed template keys widen to an index signature; the literal keys below are exactly the ones S3EnvShape names.
  return z.object(buildS3Shape(options.prefix) as S3EnvShape<TPrefix>);
}

/** Same block for a prefix only known at runtime (named providers); keys are typed as a record. */
export function createRuntimeS3EnvSchema(prefix: string) {
  return z.object(buildS3Shape(prefix));
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
