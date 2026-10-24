export type DryRunOptions = {
  /** From composeEnvSchema. Drives the per-row feature-attribution. */
  readonly sources?: Readonly<Record<string, string>>;
  /** Prefix for `pulumi config set <prefix>…` keys. Default "". */
  readonly pulumiPrefix?: string;
  /** k8s Secret name. Default "kumiko-env". */
  readonly k8sName?: string;
  /** k8s namespace. Default "default". */
  readonly k8sNamespace?: string;
};
