export {
  createEmailChannel,
  type EmailChannelOptions,
  type TenantTransportResolver,
} from "./email-channel.ts";
export { smtpEnvSchema } from "./env.ts";
export { createChannelEmailFeature } from "./feature.ts";
export { guardEmailMessage, withPiiCiphertextGuard } from "./pii-guard.ts";
export {
  createSmtpTransport,
  createSmtpTransportFromEnv,
  type SmtpEnv,
  type SmtpTransportOptions,
} from "./smtp-transport.ts";
export {
  createInMemoryTransport,
  type EmailAttachment,
  type EmailAttachmentRef,
  type EmailMessage,
  type EmailTransport,
} from "./types.ts";
