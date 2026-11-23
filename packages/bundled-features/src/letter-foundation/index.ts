export { recognizedAddressMatches } from "./address-match.ts";
export { cancelLetterBeforeHandover } from "./cancel-before-handover.ts";
export {
  isFinalLetterState,
  isLetterTransitionAllowed,
  LETTER_CAP,
  LETTER_CONFIG_KEYS,
  LETTER_ENTITY,
  LETTER_ENV,
  LETTER_ENVELOPES,
  LETTER_FAILURE_REASON,
  LETTER_FEATURE,
  LETTER_FORM_REQUIREMENTS,
  LETTER_HANDOVER_HOLD_MS,
  LETTER_JOB,
  LETTER_MONTHLY_COST_LIMIT_CONFIG,
  LETTER_PROVIDER_EXTENSION,
  LETTER_ROLES,
  LETTER_SHIPPING_MODES,
  LETTER_STATE,
  LETTER_STATES,
  LETTER_TRANSITIONS,
  LetterEvents,
  LetterHandlers,
  LetterJobs,
  LetterQueries,
  type LetterState,
} from "./constants.ts";
export { letterEntity, letterExecutor, letterSubmissionTable, letterTable } from "./entity.ts";
export { createLetterFoundationFeature, type LetterFoundationOptions } from "./feature.ts";
export { LetterAddressSchema, type SendLetterInput, SendLetterInputSchema } from "./payloads.ts";
export {
  LETTER_PROVIDER_NOT_CONFIGURED,
  LetterProviderNotConfiguredError,
  type ResolvedLetterProvider,
  resolveLetterProvider,
  resolveLetterProviderOrFailure,
  type SelectedLetterProvider,
  selectLetterProvider,
  selectLetterProviderOrFailure,
} from "./provider-resolver.ts";
export { type SendLetterContext, type SendLetterResult, sendLetter } from "./send-letter.ts";
export { type LetterTransition, transitionLetter } from "./transitions.ts";
export {
  isLetterProviderPlugin,
  type LetterAcceptance,
  type LetterAddress,
  type LetterCancelRefusalReason,
  type LetterCancelResult,
  type LetterEnvelope,
  type LetterFormRequirement,
  type LetterMoney,
  type LetterPriceSource,
  type LetterProof,
  type LetterProvider,
  type LetterProviderCapabilities,
  type LetterProviderContext,
  type LetterProviderOrder,
  type LetterProviderPlugin,
  type LetterProviderState,
  type LetterProviderStatus,
  type LetterQuote,
  type LetterRejection,
  type LetterRejectionCode,
  type LetterShippingMode,
  type LetterSpec,
  type LetterSubmission,
  type LetterSubmitResult,
} from "./types.ts";
