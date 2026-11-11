import type { ReactNode } from "react";
import { useContentEditor } from "../app/content-editors.tsx";

export function DocumentFieldEditor({
  id,
  value,
  readOnly,
  onChange,
}: {
  readonly id: string;
  readonly value: string;
  readonly readOnly: boolean;
  readonly onChange: (value: unknown) => void;
}): ReactNode {
  const Editor = useContentEditor("document");
  return (
    <Editor
      id={id}
      value={value}
      readOnly={readOnly}
      variables={[]}
      formatting="text"
      onChange={(v) => onChange(v)}
    />
  );
}
