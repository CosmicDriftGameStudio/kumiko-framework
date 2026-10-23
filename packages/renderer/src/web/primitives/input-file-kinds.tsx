import { FileUploadInput } from "./file-upload.tsx";
import { FilesDropzoneInput } from "./files-dropzone.tsx";
import { uploadTargetProps } from "./input-optional-props.ts";
import type { KindRenderer } from "./input-shared.ts";

export const renderFileKind: KindRenderer<"file" | "image"> = (props) => (
  <FileUploadInput
    kind={props.kind}
    id={props.id}
    value={props.value}
    onChange={props.onChange}
    {...(props.accept !== undefined && { accept: props.accept })}
    {...(props.disabled !== undefined && { disabled: props.disabled })}
    {...uploadTargetProps(props)}
    {...(props.imageVariant !== undefined && { imageVariant: props.imageVariant })}
    {...(props.capture !== undefined && { capture: props.capture })}
    {...(props.directory !== undefined && { directory: props.directory })}
    {...(props.onFilesPicked !== undefined && { onFilesPicked: props.onFilesPicked })}
    {...(props.pickLabel !== undefined && { pickLabel: props.pickLabel })}
    {...(props.testId !== undefined && { testId: props.testId })}
  />
);

export const renderFilesDropzoneKind: KindRenderer<"files-dropzone"> = (props) => (
  <FilesDropzoneInput
    id={props.id}
    value={props.value}
    onChange={props.onChange}
    {...(props.accept !== undefined && { accept: props.accept })}
    {...(props.maxSize !== undefined && { maxSize: props.maxSize })}
    {...(props.maxCount !== undefined && { maxCount: props.maxCount })}
    {...(props.disabled !== undefined && { disabled: props.disabled })}
    {...uploadTargetProps(props)}
    {...(props.testId !== undefined && { testId: props.testId })}
  />
);
