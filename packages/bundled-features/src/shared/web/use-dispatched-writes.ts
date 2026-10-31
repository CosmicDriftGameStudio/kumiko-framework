import { useDispatcher } from "@cosmicdrift/kumiko-renderer";
import { useState } from "react";

// Busy flag + error key shared by the folders/tags management surfaces: every
// write goes through the dispatcher and a failed one surfaces its i18n key.
export function useDispatchedWrites(onWriteSucceeded?: () => Promise<void> | void) {
  const dispatcher = useDispatcher();
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const writeOk = async (type: string, payload: Record<string, unknown>): Promise<boolean> => {
    const result = await dispatcher.write(type, payload);
    if (!result.isSuccess) {
      setErrorKey(result.error.i18nKey);
      return false;
    }
    return true;
  };

  const apply = async (write: () => Promise<boolean>): Promise<void> => {
    setBusy(true);
    setErrorKey(null);
    try {
      if (await write()) await onWriteSucceeded?.();
    } finally {
      setBusy(false);
    }
  };

  return { busy, setBusy, errorKey, setErrorKey, writeOk, apply };
}
