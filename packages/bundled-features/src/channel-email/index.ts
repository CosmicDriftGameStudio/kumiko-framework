export { createEmailChannel, type EmailChannelOptions } from "./email-channel";
export { createChannelEmailFeature } from "./feature";
export {
  createSmtpTransport,
  createSmtpTransportFromEnv,
  type SmtpEnv,
  type SmtpTransportOptions,
} from "./smtp-transport";
export { createInMemoryTransport, type EmailMessage, type EmailTransport } from "./types";
