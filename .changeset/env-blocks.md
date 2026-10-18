---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-bundled-features": minor
---

Env blocks per feature and a typed composeEnvSchema

<!-- kumiko-changes
feature: framework
type: improvement
title: composeEnvSchema returns a typed schema
detail: composeEnvSchema infers the merged shape from core, extend and every feature typed with featureWithEnvSchema(feature, schema), so parseEnv(composed.schema, …) returns typed values instead of a string record. optionalFeatures types those fields optional. A feature list widened to FeatureDefinition[] still compiles and contributes no keys to the type. extend may now repeat a feature's field when it is the same instance, so an app can spread a block such as stripeEnvSchema next to the mounted feature; a different field under that key still throws.
-->

<!-- kumiko-changes
feature: crypto-shredding
type: improvement
title: kmsEnvSchema declares the subject-key KMS variables
detail: kmsEnvSchema lists the 13 KMS slots (PLATFORM_KEK, its rotation predecessor and versions, KUMIKO_BLIND_INDEX_KEY, SUBJECT_KEYS_DATABASE_URL, the _CIPHERTEXT twins and the Key Manager coordinates), all optional. createCryptoShreddingFeature registers it, so composeEnvSchema picks it up.
-->

<!-- kumiko-changes
feature: channel-email
type: improvement
title: smtpEnvSchema declares the SMTP_* variables
detail: smtpEnvSchema covers SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS and SMTP_FROM, all optional, and createChannelEmailFeature registers it. It lives next to createSmtpTransportFromEnv, which reads these variables.
-->

<!-- kumiko-changes
feature: file-provider-s3
type: improvement
title: s3EnvSchema and createS3EnvSchema declare the S3 provider variables
detail: s3EnvSchema covers S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT and S3_FORCE_PATH_STYLE; createFileProviderS3Feature({ fromEnv: true }) registers it. createS3EnvSchema({ prefix }) builds the same block under another prefix, for example RELEASES_S3_. The endpoint must use https unless the host is loopback, and a blank endpoint counts as unset.
-->

<!-- kumiko-changes
feature: subscription-stripe
type: improvement
title: stripeEnvSchema adds price slots to the Stripe env block
detail: stripeEnvSchema({ prices: ["PRO", "TEAM"] }) returns the bridge keys plus one optional STRIPE_PRICE_<NAME> per price, each checked for the price_ prefix. Spread it into composeEnvSchema({ extend }) next to createSubscriptionStripeFeature; the shared bridge fields are no key clash.
-->

<!-- kumiko-changes
feature: foundation-shared
type: improvement
title: buildInfoEnvSchema and demoAdminEnvSchema
detail: buildInfoEnvSchema declares BUILD_VERSION and BUILD_TIME. demoAdminEnvSchema declares the seed logins DEMO_ADMIN_EMAIL and DEMO_SYSADMIN_EMAIL (required), their passwords (optional, at least 16 characters) and an optional DEMO_TENANT_ID. Apps add both through extend.
-->

<!-- kumiko-changes
feature: auth-mfa
type: improvement
title: MFA token secrets are optional and bound at boot
detail: setupTokenSecret and challengeTokenSecret on createAuthMfaFeature are optional. Unset, the boot binds them through bindMfaTokenSecretsFromFeature(feature)(masterSecret, env): MFA_SETUP_TOKEN_SECRET and MFA_CHALLENGE_TOKEN_SECRET from env when set, otherwise derived from the master secret. mfaTokenSecretsEnvSchema declares both variables and the feature registers it next to the secrets master-key slot. A handler called before the binding throws instead of signing with an empty key.
-->

<!-- kumiko-changes
feature: secrets
type: improvement
title: createSecretsFeature carries its env schema type
detail: createSecretsFeature returns the feature typed with secretsEnvSchema, so composeEnvSchema types the KUMIKO_SECRETS_MASTER_KEY_* variables.
-->

<!-- kumiko-changes
feature: auth-email-password
type: improvement
title: createAuthEmailPasswordFeature carries its env schema type
detail: createAuthEmailPasswordFeature returns the feature typed with authEmailPasswordEnvSchema, so composeEnvSchema types JWT_SECRET and JWT_ISSUER.
-->
