export const PROVIDERS = ["anthropic", "openai", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const ANTHROPIC_CONNECTION_ID = "00000000-0000-4000-8000-0000000000a1";
export const OPENROUTER_CONNECTION_ID = "00000000-0000-4000-8000-0000000000a2";

export const PROVIDER_LABELS: Readonly<Record<Provider, string>> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

type ModelRow = {
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
};

export const MODELS_BY_PROVIDER: Readonly<Record<Provider, readonly ModelRow[]>> = {
  anthropic: [
    {
      value: "claude-sonnet-5-5",
      label: "claude-sonnet-5-5",
      description: "Schnell, gut für Antwortentwürfe",
      group: "Empfohlen",
    },
    {
      value: "claude-opus-5",
      label: "claude-opus-5",
      description: "Höchste Qualität, teurer",
      group: "Empfohlen",
    },
    {
      value: "claude-haiku-4-5",
      label: "claude-haiku-4-5",
      description: "Sehr günstig, kurze Texte",
      group: "Weitere Modelle",
    },
  ],
  openai: [
    {
      value: "gpt-4o",
      label: "gpt-4o",
      description: "Allrounder mit Bildverständnis",
      group: "Empfohlen",
    },
    {
      value: "gpt-4o-mini",
      label: "gpt-4o-mini",
      description: "Günstig für einfache Aufgaben",
      group: "Weitere Modelle",
    },
  ],
  openrouter: [
    {
      value: "openai/gpt-4o",
      label: "openai/gpt-4o",
      description: "Über OpenRouter geroutet",
      group: "Empfohlen",
    },
    {
      value: "qwen/qwen3-asr-flash",
      label: "qwen/qwen3-asr-flash",
      description: "Spracherkennung",
      group: "Weitere Modelle",
    },
  ],
};

export const AI_STEPS = [
  {
    value: "reply-draft",
    label: "Antwort entwerfen",
    description: "Genutzt in: Tickets › Ticket bearbeiten",
  },
  {
    value: "ticket-triage",
    label: "Ticket einordnen",
    description: "Genutzt in: Tickets › Neues Ticket",
  },
] as const;
