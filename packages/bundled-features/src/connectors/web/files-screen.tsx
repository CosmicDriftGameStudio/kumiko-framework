import {
  useDebouncedValue,
  useDispatcher,
  usePrimitives,
  useQuery,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { QueryTable, StatCard, useToast } from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";
import {
  ConnectorHandlers,
  ConnectorQueries,
  FILE_NAME_CELL_COMPONENT,
} from "./client-constants.ts";

type Crumb = {
  readonly label: string;
  readonly connectorId: string;
  readonly folderId: string | null;
};
type FileRow = Readonly<Record<string, unknown>> & {
  readonly kind: "device" | "folder" | "file";
  readonly name: string;
  readonly receivedAt: string | null;
  readonly connectorId: string;
  readonly folderId: string | null;
  readonly fileCount: number | null;
  readonly totalBytes: number;
  readonly deleting: boolean;
};
type FilesData = {
  readonly usedBytes: number;
  readonly deletingBytes: number;
  readonly quotaBytes: number;
  readonly breadcrumb: readonly Crumb[];
  readonly rows: readonly FileRow[];
  readonly nextCursor: string | null;
};
type SearchHit = {
  readonly id: string;
  readonly kind: "folder" | "file";
  readonly name: string;
  readonly connectorId: string;
  readonly folderId: string | null;
  readonly path: string;
  readonly totalBytes: number;
};
type SearchData = { readonly rows: readonly SearchHit[]; readonly truncated: boolean };

const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_TERM_LENGTH = 2;

type SortField = "name" | "size" | "received";
// Column field (the table's) to the sort key the query takes.
const SORT_FIELD_OF_COLUMN: Readonly<Record<string, SortField>> = {
  name: "name",
  size: "size",
  receivedAt: "received",
};
const COLUMN_OF_SORT_FIELD: Readonly<Record<SortField, string>> = {
  name: "name",
  size: "size",
  received: "receivedAt",
};
type Location = {
  readonly connectorId?: string;
  readonly folderId?: string;
  readonly cursor?: string;
  readonly sort?: SortField;
  readonly sortDirection?: "asc" | "desc";
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

function SearchResults({
  location,
  term,
  onOpen,
}: {
  readonly location: Location;
  readonly term: string;
  readonly onOpen: (hit: SearchHit) => void;
}): ReactNode {
  const t = useTranslation();
  const { DataTable } = usePrimitives();
  const { data: found } = useQuery<SearchData>(ConnectorQueries.inboundSearch, {
    connectorId: location.connectorId,
    folderId: location.folderId,
    term,
  });
  return (
    <>
      <DataTable
        testId="connector-files-search-results"
        screenPadding={false}
        columns={[
          {
            field: "name",
            label: t("connectors.files.col.name"),
            type: "text",
            sortable: false,
            renderer: { react: { __component: FILE_NAME_CELL_COMPONENT } },
          },
          {
            field: "path",
            label: t("connectors.files.col.path"),
            type: "text",
            sortable: false,
          },
          {
            field: "size",
            label: t("connectors.files.col.size"),
            type: "text",
            sortable: false,
          },
        ]}
        rows={(found?.rows ?? []).map((hit) => ({
          id: hit.id,
          values: {
            ...hit,
            size: hit.kind === "file" ? formatBytes(hit.totalBytes) : "",
            deleting: false,
          },
        }))}
        onRowClick={(row) => {
          const hit = found?.rows.find((candidate) => candidate.id === row.id);
          if (hit) onOpen(hit);
        }}
        emptyState={<p>{t("connectors.files.search.empty")}</p>}
      />
      {found?.truncated ? (
        <p className="text-sm text-muted-foreground">{t("connectors.files.search.truncated")}</p>
      ) : null}
    </>
  );
}

export function ConnectorFilesScreen(): ReactNode {
  const t = useTranslation();
  const { Button, Input } = usePrimitives();
  const [searchText, setSearchText] = useState("");
  const term = useDebouncedValue(searchText.trim(), SEARCH_DEBOUNCE_MS);
  const searching = term.length >= MIN_SEARCH_TERM_LENGTH;
  const dispatcher = useDispatcher();
  const { toast } = useToast();
  const [location, setLocation] = useState<Location>({});
  const { data, refetch } = useQuery<FilesData>(ConnectorQueries.inboundFolder, location, {
    live: true,
  });

  const removeFile = async (id: string): Promise<void> => {
    const result = await dispatcher.write(ConnectorHandlers.deleteFile, { id });
    if (!result.isSuccess) toast({ title: t("connectors.files.deleteFailed"), variant: "bad" });
    await refetch();
  };

  const removeFolder = async (id: string): Promise<void> => {
    const result = await dispatcher.write(ConnectorHandlers.deleteFolder, { id });
    if (!result.isSuccess) toast({ title: t("connectors.files.deleteFailed"), variant: "bad" });
    await refetch();
  };

  const openHit = (hit: SearchHit): void => {
    setSearchText("");
    setLocation({
      connectorId: hit.connectorId,
      ...(hit.folderId !== null && { folderId: hit.folderId }),
    });
  };

  const crumbs: readonly Crumb[] = data?.breadcrumb ?? [];
  const trail: readonly Crumb[] = [
    { label: t("connectors.files.root"), connectorId: "", folderId: null },
    ...crumbs,
  ];
  const confirmFileText = (row: { readonly values: Readonly<Record<string, unknown>> }): string =>
    t("connectors.files.deleteFile.confirm", { name: String(row.values["name"]) });
  const confirmFolderText = (row: {
    readonly values: Readonly<Record<string, unknown>>;
  }): string => {
    const count = Number(row.values["fileCount"] ?? 0);
    return t("connectors.files.deleteFolder.confirm", {
      name: String(row.values["name"]),
      files: t(
        count === 1 ? "connectors.files.fileCount.one" : "connectors.files.fileCount.other",
        { count },
      ),
      size: formatBytes(Number(row.values["totalBytes"] ?? 0)),
    });
  };
  return (
    <div className="flex flex-col gap-4 p-6">
      <StatCard
        label={t("connectors.files.storage")}
        value={formatBytes(data?.usedBytes ?? 0)}
        sub={[
          t("connectors.files.storageOf", { quota: formatBytes(data?.quotaBytes ?? 0) }),
          ...(data && data.deletingBytes > 0
            ? [t("connectors.files.storageDeleting", { size: formatBytes(data.deletingBytes) })]
            : []),
        ].join(" · ")}
        testId="connector-files-storage"
      />
      <nav
        aria-label={t("connectors.files.breadcrumb")}
        className="flex flex-wrap items-center gap-1.5 text-sm"
      >
        {trail.map((crumb, index) => {
          const isCurrent = index === trail.length - 1;
          return (
            <span key={crumb.folderId ?? crumb.connectorId} className="flex items-center gap-1.5">
              {index > 0 ? (
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
              ) : null}
              {isCurrent ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {crumb.label}
                </span>
              ) : (
                <Button
                  variant="plain"
                  className="text-primary underline underline-offset-4 hover:no-underline"
                  onClick={() =>
                    setLocation(
                      crumb.connectorId === ""
                        ? {}
                        : {
                            connectorId: crumb.connectorId,
                            ...(crumb.folderId !== null && { folderId: crumb.folderId }),
                          },
                    )
                  }
                >
                  {crumb.label}
                </Button>
              )}
            </span>
          );
        })}
      </nav>
      <Input
        kind="text"
        id="connector-files-search"
        testId="connector-files-search"
        name="search"
        value={searchText}
        onChange={setSearchText}
        placeholder={t("connectors.files.search.placeholder")}
      />
      {searching ? (
        <SearchResults location={location} term={term} onOpen={openHit} />
      ) : (
        <QueryTable<FilesData>
          query={ConnectorQueries.inboundFolder}
          payload={location}
          live
          testId="connector-files-table"
          screenPadding={false}
          sort={
            location.sort === undefined
              ? null
              : { field: COLUMN_OF_SORT_FIELD[location.sort], dir: location.sortDirection ?? "asc" }
          }
          onSortChange={(next) => {
            const field = next === null ? undefined : SORT_FIELD_OF_COLUMN[next.field];
            setLocation({
              connectorId: location.connectorId,
              folderId: location.folderId,
              ...(next !== null && field !== undefined && { sort: field, sortDirection: next.dir }),
            });
          }}
          columns={[
            {
              field: "name",
              label: t("connectors.files.col.name"),
              sortable: true,
              renderer: { react: { __component: FILE_NAME_CELL_COMPONENT } },
            },
            { field: "kindLabel", label: t("connectors.files.col.type") },
            { field: "fileCount", label: t("connectors.files.col.files") },
            { field: "size", label: t("connectors.files.col.size"), sortable: true },
            {
              field: "receivedAt",
              label: t("connectors.files.col.received"),
              type: "timestamp",
              sortable: true,
            },
          ]}
          rows={(answer) =>
            answer.rows.map((row) => ({
              ...row,
              kindLabel: t(`connectors.files.kind.${row.kind}`),
              fileCount: row.fileCount === null ? "" : String(row.fileCount),
              size: formatBytes(row.totalBytes),
            }))
          }
          onRowClick={(row) => {
            const { kind, connectorId, folderId } = row.values;
            if (
              kind === "file" ||
              row.values["deleting"] === true ||
              typeof connectorId !== "string"
            )
              return;
            setLocation({ connectorId, ...(typeof folderId === "string" && { folderId }) });
          }}
          rowActions={[
            {
              id: "delete-file",
              label: t("connectors.files.deleteFile"),
              style: "danger",
              confirm: confirmFileText,
              isVisible: (row) => row.values["kind"] === "file",
              onTrigger: (row) => removeFile(row.id),
            },
            {
              id: "delete-folder",
              label: t("connectors.files.deleteFolder"),
              style: "danger",
              confirm: confirmFolderText,
              // A device row is removed by revoking the connector, not here.
              isVisible: (row) =>
                row.values["kind"] === "folder" && row.values["deleting"] !== true,
              onTrigger: (row) => removeFolder(row.id),
            },
          ]}
          emptyState={
            <div>
              <p className="font-medium">{t("connectors.files.empty.title")}</p>
              <p className="text-sm text-muted-foreground">{t("connectors.files.empty.hint")}</p>
            </div>
          }
        />
      )}
      {!searching && (data?.nextCursor || location.cursor) ? (
        <div className="flex gap-2">
          {location.cursor ? (
            <Button variant="ghost" onClick={() => setLocation({ ...location, cursor: undefined })}>
              {t("connectors.files.first")}
            </Button>
          ) : null}
          {data?.nextCursor ? (
            <Button
              variant="ghost"
              onClick={() => setLocation({ ...location, cursor: data.nextCursor ?? undefined })}
            >
              {t("connectors.files.more")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
