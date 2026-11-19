export type BootWarningKind =
  | "nav/access-inversion"
  | "nav/screen-unreachable"
  | "config/toggleable-dependency"
  | "security/baseline-incomplete"
  | "access/unique-role"
  | "list/hidden-file-column"
  | "api/self-use"
  | "gdpr/ephemeral-store"
  | "gdpr/s3-env-unset"
  | "pii/owner-not-user-reference"
  | "pii/unannotated-personal-name"
  | "retention/invalid-keep-for"
  | "retention/block-delete-without-anonymize";

export type BootWarning = {
  readonly kind: BootWarningKind;
  readonly feature?: string;
  readonly message: string;
};

export type BootWarningSink = (warning: BootWarning) => void;

export type BootValidationResult = { readonly warnings: readonly BootWarning[] };
