/** Raw step nutzdaten (YAML) before hydration. */

export type CaptionRaw = {
  readonly de: string;
  readonly en: string;
};

export type VerifyMode = "e2e" | "record-only" | "skip";

export type StepRaw = {
  readonly id: string;
  readonly kind: "cli" | "browser" | "editor";
  readonly caption: CaptionRaw;
  readonly verify?: VerifyMode;
  /** CLI: named preset from presets/cli.yaml */
  readonly preset?: string;
  readonly args?: Readonly<Record<string, string | number | boolean>>;
  /** CLI: verbatim command (overrides preset) */
  readonly command?: string;
  readonly waitMs?: number;
  readonly waitForPort?: number;
  /** Editor */
  readonly file?: string;
  /** `$fixture:notes-feature.ts` or literal body */
  readonly content?: string;
  /** Browser */
  readonly navigate?: string;
  readonly click?: string;
  readonly waitFor?: string;
  readonly fill?: Readonly<Record<string, string>>;
};

export type DemoManifest = {
  readonly title: string;
  readonly vars?: Readonly<Record<string, string | number>>;
  readonly steps: readonly string[];
  readonly output?: {
    readonly marketing?: string;
  };
};

export type CliPreset = {
  readonly template: string;
  /** Appended to install command when step args.yes is true (else empty). */
  readonly yesSuffix?: string;
  readonly wait?: "port" | "sleep" | "none";
  readonly waitForPort?: string | number;
  readonly waitMs?: number;
};

export type CliPresetFile = {
  readonly presets: Readonly<Record<string, CliPreset>>;
};

