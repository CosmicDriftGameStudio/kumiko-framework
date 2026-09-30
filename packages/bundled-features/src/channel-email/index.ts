export { createEmailChannel, type EmailChannelOptions } from "./email-channel.js";
export { createChannelEmailFeature } from "./feature.js";
export { guardEmailMessage, withPiiCiphertextGuard } from "./pii-guard.js";
export {
  createSmtpTransport,
  createSmtpTransportFromEnv,
  type SmtpEnv,
  type SmtpTransportOptions,
} from "./smtp-transport.js";
export { createInMemoryTransport, type EmailMessage, type EmailTransport } from "./types.js";
