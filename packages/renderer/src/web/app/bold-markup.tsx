import type { ReactNode } from "react";

/** Renders `**bold**` runs of a plain text as <strong>; text without markers stays a single string. */
export function renderBoldMarkup(text: string): ReactNode {
  const pieces = text.split("**");
  // An unpaired marker is literal text, not the start of a bold run up to the end.
  if (pieces.length === 1 || pieces.length % 2 === 0) return text;
  let offset = 0;
  return pieces.map((piece, pieceIndex) => {
    const key = offset;
    offset += piece.length + 2;
    return pieceIndex % 2 === 1 ? (
      <strong key={key} className="font-semibold">
        {piece}
      </strong>
    ) : (
      <span key={key}>{piece}</span>
    );
  });
}
