import type { ReactNode } from "react";
import type { PhotoGridProps } from "../../index.ts";
import { FileThumbnail } from "./file-thumbnail.tsx";

export function DefaultPhotoGrid({ tiles, testId }: PhotoGridProps): ReactNode {
  return (
    <ul
      data-testid={testId}
      className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 lg:grid-cols-4"
    >
      {tiles.map((tile) => (
        <li
          key={tile.id}
          data-testid={testId !== undefined ? `${testId}-tile-${tile.id}` : undefined}
          className="flex flex-col gap-2 rounded-lg border bg-card p-2"
        >
          <FileThumbnail fileId={tile.imageId ?? ""} className="aspect-[4/3] w-full" />
          {tile.caption !== undefined && (
            <span className="truncate text-sm text-muted-foreground">{tile.caption}</span>
          )}
          {tile.actions !== undefined && <div className="flex flex-wrap gap-2">{tile.actions}</div>}
        </li>
      ))}
    </ul>
  );
}
