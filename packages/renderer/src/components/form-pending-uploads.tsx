import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type TrackFormUpload = <T>(upload: () => Promise<T>) => Promise<T>;

const runUntracked: TrackFormUpload = (upload) => upload();

const FormUploadTrackerContext = createContext<TrackFormUpload>(runUntracked);

export const FormUploadTrackerProvider = FormUploadTrackerContext.Provider;

// A widget registers its in-flight upload here so the surrounding form can hold
// back submit until the file id has reached the form value. Outside a form the
// upload simply runs.
export function useTrackFormUpload(): TrackFormUpload {
  return useContext(FormUploadTrackerContext);
}

export function useFormPendingUploadsHost() {
  const [pendingUploads, setPendingUploads] = useState(0);
  // Mirror for handleSubmit: it must see a running upload before React re-renders.
  const pendingUploadsRef = useRef(0);
  const trackUpload = useCallback<TrackFormUpload>(async (upload) => {
    pendingUploadsRef.current += 1;
    setPendingUploads(pendingUploadsRef.current);
    try {
      return await upload();
    } finally {
      pendingUploadsRef.current -= 1;
      setPendingUploads(pendingUploadsRef.current);
    }
  }, []);
  return useMemo(
    () => ({ pendingUploads, pendingUploadsRef, trackUpload }),
    [pendingUploads, trackUpload],
  );
}
