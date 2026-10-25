export const FILE_PROBE_KEYS = {
  area: "file-foundation.probe.area",
  label: "file-foundation.probe.storage-roundtrip.label",
  reachable: "file-foundation.probe.storage-roundtrip.reachable",
  notConfigured: "file-foundation.probe.not-configured",
} as const;

export const FILE_FOUNDATION_I18N = {
  [FILE_PROBE_KEYS.area]: { en: "File storage" },
  [FILE_PROBE_KEYS.label]: { en: "Write, read and delete a test file" },
  [FILE_PROBE_KEYS.reachable]: { en: "Storage reachable" },
  [FILE_PROBE_KEYS.notConfigured]: { en: "No file storage set up" },
} as const;
