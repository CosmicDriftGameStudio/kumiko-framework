export type {
  FeatureDisabledDetails,
  FieldIssue,
  NotFoundDetails,
  PreconditionFailedDetails,
  RateLimitDetails,
  UnconfiguredDetails,
  UniqueViolationDetails,
  UnprocessableOpts,
  ValidationDetails,
  VersionConflictDetails,
} from "./classes.js";
export {
  AccessDeniedError,
  ConflictError,
  FeatureDisabledError,
  IdempotentReplayError,
  InternalError,
  NotFoundError,
  PreconditionFailedError,
  RateLimitError,
  RateLimitUnavailableError,
  UnauthenticatedError,
  UnconfiguredError,
  UniqueViolationError,
  UnprocessableError,
  ValidationError,
  VersionConflictError,
} from "./classes.js";
export type { ErrorCtorInput, ErrorOpts } from "./kumiko-error.js";
export { isKumikoError, KumikoError } from "./kumiko-error.js";
export { memberResolutionReadOnlyDenied } from "./member-resolution.js";
export type { AgentReason, FrameworkReason } from "./reasons.js";
export { AgentReasons, FrameworkReasons } from "./reasons.js";
export type { ErrorLogEntry, ErrorResponseBody } from "./serialize.js";
export { buildErrorLog, serializeError } from "./serialize.js";
export { toKumikoError } from "./to-kumiko-error.js";
export type { InvalidTransitionDetails } from "./transition-details.js";
export { buildInvalidTransitionDetails } from "./transition-details.js";
export type { WriteErrorInfo, WriteFailure } from "./write-error-info.js";
export {
  failNotFound,
  failTransition,
  failUnprocessable,
  reraiseAsKumikoError,
  toWriteErrorInfo,
  writeFailure,
} from "./write-error-info.js";
export { validationErrorFromZod } from "./zod-bridge.js";
