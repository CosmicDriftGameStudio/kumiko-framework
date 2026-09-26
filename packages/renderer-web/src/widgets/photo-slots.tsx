import { useTranslation } from "@cosmicdrift/kumiko-renderer";
import { Camera, Check, Loader2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toAcceptAttr } from "../lib/accept-attr";
import { cn } from "../lib/cn";
import { resizeImageBeforeUpload } from "../lib/resize-image";
import { matchesAccept } from "./upload-zone";

export type PhotoSlotSpec = {
  readonly id: string;
  /** The shot this slot asks for ("Front, angled") — the empty slot's
   *  caption and the filled thumbnail's alt text. */
  readonly label: string;
  /** Set once the app holds the photo; the slot then shows the thumbnail. */
  readonly previewUrl?: string;
  /** Corner tag on a filled slot, e.g. "Cover photo". */
  readonly badge?: string;
};

export type PhotoSlotsProps = {
  readonly slots: readonly PhotoSlotSpec[];
  /** Stores the photo for `slotId`. Throws on failure — the message is shown
   *  under the slot. The app then passes the slot's `previewUrl`. */
  readonly onUpload: (slotId: string, file: File) => Promise<void>;
  /** Second line on an empty slot, e.g. "Camera or gallery". */
  readonly pickHint?: ReactNode;
  readonly accept?: readonly string[];
  /** Opens that camera directly on phones; unset keeps camera and gallery. */
  readonly capture?: "environment" | "user";
  /** The first slot spans the full row (cover photo). Defaults to true. */
  readonly featureFirst?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
};

type SlotUploadState =
  | { readonly kind: "uploading" }
  | { readonly kind: "error"; readonly message: string };

const DEFAULT_ACCEPT: readonly string[] = ["image/*"];

/** Guided photo capture: one tile per requested shot in a two-column grid,
 *  each its own camera/gallery picker, filled tiles show the thumbnail. */
export function PhotoSlots({
  slots,
  onUpload,
  pickHint,
  accept = DEFAULT_ACCEPT,
  capture,
  featureFirst = true,
  disabled,
  testId,
}: PhotoSlotsProps): ReactNode {
  const t = useTranslation();
  const [uploadStates, setUploadStates] = useState<Readonly<Record<string, SlotUploadState>>>({});

  function setSlotState(slotId: string, state: SlotUploadState | undefined): void {
    setUploadStates((prev) => {
      const { [slotId]: _previous, ...rest } = prev;
      return state === undefined ? rest : { ...rest, [slotId]: state };
    });
  }

  async function uploadIntoSlot(slotId: string, file: File): Promise<void> {
    if (!matchesAccept(file, accept)) {
      setSlotState(slotId, { kind: "error", message: t("kumiko.widget.upload.rejected-type") });
      return;
    }
    setSlotState(slotId, { kind: "uploading" });
    try {
      await onUpload(slotId, await resizeImageBeforeUpload(file));
      setSlotState(slotId, undefined);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("kumiko.widget.upload.error");
      setSlotState(slotId, { kind: "error", message });
    }
  }

  const acceptAttr = toAcceptAttr(accept);

  return (
    <div data-testid={testId} className="grid grid-cols-2 gap-2.5">
      {slots.map((slot, index) => {
        const uploadState = uploadStates[slot.id];
        const isUploading = uploadState?.kind === "uploading";
        const isFeatured = featureFirst && index === 0;
        const slotTestId = testId !== undefined ? `${testId}-slot-${slot.id}` : undefined;
        return (
          <div key={slot.id} className={cn("flex flex-col gap-1", isFeatured && "col-span-2")}>
            <label
              data-testid={slotTestId}
              data-filled={slot.previewUrl !== undefined ? "true" : undefined}
              className={cn(
                "relative flex cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border-2 text-center text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                isFeatured ? "h-52" : "h-32",
                slot.previewUrl !== undefined
                  ? "border-transparent"
                  : "border-dashed border-primary/60 bg-primary/5 text-primary",
                (disabled === true || isUploading) && "cursor-not-allowed opacity-60",
              )}
            >
              {slot.previewUrl !== undefined ? (
                <>
                  <img
                    src={slot.previewUrl}
                    alt={slot.label}
                    className="absolute inset-0 size-full object-cover"
                  />
                  {slot.badge !== undefined && (
                    <span className="absolute bottom-2 left-2 rounded-full bg-background/90 px-2 py-0.5 text-xs font-semibold text-foreground">
                      {slot.badge}
                    </span>
                  )}
                  <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-status-ok text-background">
                    <Check aria-hidden="true" className="size-3.5" />
                  </span>
                </>
              ) : (
                <>
                  {isUploading ? (
                    <Loader2 aria-hidden="true" className="size-6 animate-spin" />
                  ) : (
                    <Camera aria-hidden="true" className="size-6" />
                  )}
                  <span className="font-semibold">{slot.label}</span>
                  {pickHint !== undefined && <span className="text-xs">{pickHint}</span>}
                </>
              )}
              {isUploading && (
                <span className="sr-only">{t("kumiko.widget.upload.uploading")}</span>
              )}
              <input
                type="file"
                className="sr-only"
                data-testid={slotTestId !== undefined ? `${slotTestId}-input` : undefined}
                aria-label={slot.label}
                disabled={disabled === true || isUploading}
                {...(acceptAttr !== undefined && { accept: acceptAttr })}
                {...(capture !== undefined && { capture })}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // Reset so picking the same file again after an error still fires change.
                  e.target.value = "";
                  if (file !== undefined) void uploadIntoSlot(slot.id, file);
                }}
              />
            </label>
            {uploadState?.kind === "error" && (
              <p role="alert" className="text-xs text-destructive">
                {uploadState.message}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
