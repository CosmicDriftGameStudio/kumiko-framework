import type { ReactNode } from "react";
import type { PhotoGridProps } from "../../index.ts";
import { cn } from "../lib/cn.ts";
import { FileThumbnail } from "./file-thumbnail.tsx";

export function DefaultPhotoGrid({ tiles, testId }: PhotoGridProps): ReactNode {
  return (
    <ul
      data-testid={testId} // Column templates as arbitrary properties: two columns on a phone, three from md.
      className="m-0 grid list-none gap-3.5 p-0 [grid-template-columns:repeat(2,minmax(0,1fr))] md:[grid-template-columns:repeat(3,minmax(0,1fr))]"
    >
      {tiles.map((tile) => (
        <li
          key={tile.id}
          data-testid={testId !== undefined ? `${testId}-tile-${tile.id}` : undefined}
          className={cn(
            "flex flex-col overflow-hidden rounded-lg border border-border bg-card",
            tile.leadsOnNarrow === true && "max-sm:-order-1",
          )}
        >
          <div className="relative">
            <FileThumbnail
              fileId={tile.imageId ?? ""}
              className="aspect-[3/2] w-full object-cover md:aspect-[2/1]"
            />
            {tile.badge !== undefined && (
              <span
                data-slot="photo-badge"
                className="absolute top-2 left-2 rounded-full bg-status-warn-surface px-2 py-0.5 text-xs font-medium text-status-warn"
              >
                {tile.badge}
              </span>
            )}
          </div>
          {/* One row: caption left, actions right; wraps when a phone tile is too narrow. */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-3">
            {tile.caption !== undefined && (
              <span className="min-w-0 truncate text-[13px] text-foreground">{tile.caption}</span>
            )}
            {tile.actions !== undefined && (
              <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
                {tile.actions}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
