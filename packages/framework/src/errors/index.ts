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
} from "./classes.ts";
export {
  AccessDeniedError,
  ConflictError,
  FeatureDisabledError,
  IdempotentReplayError,
  InternalError,
  MemberReadTimeoutError,
  NotFoundError,
  PreconditionFailedError,
  RateLimitError,
  RateLimitUnavailableError,
  RecordLockedError,
  UnauthenticatedError,
  UnconfiguredError,
  UniqueViolationError,
  UnprocessableError,
  ValidationError,
  VersionConflictError,
} from "./classes.ts";
export type { ErrorDocsConfig } from "./docs-url.ts";
export { resolveErrorDocsUrl } from "./docs-url.ts";
export type { ErrorCtorInput, ErrorOpts } from "./kumiko-error.ts";
export { isKumikoError, KumikoError } from "./kumiko-error.ts";
export { memberResolutionReadOnlyDenied } from "./member-resolution.ts";
export type { AgentReason, FrameworkReason } from "./reasons.ts";
export { AgentReasons, FrameworkReasons } from "./reasons.ts";
export type { ErrorLogEntry, ErrorResponseBody } from "./serialize.ts";
export { buildErrorLog, serializeError } from "./serialize.ts";
export { isSubjectErasedConflict, subjectErasedConflict } from "./subject-erased.ts";
export { toKumikoError } from "./to-kumiko-error.ts";
export type { InvalidTransitionDetails } from "./transition-details.ts";
export { buildInvalidTransitionDetails } from "./transition-details.ts";
export type { WriteErrorInfo, WriteFailure } from "./write-error-info.ts";
export {
  failNotFound,
  failTransition,
  failUnprocessable,
  reraiseAsKumikoError,
  toWriteErrorInfo,
  writeFailure,
} from "./write-error-info.ts";
export { validationErrorFromZod } from "./zod-bridge.ts";
