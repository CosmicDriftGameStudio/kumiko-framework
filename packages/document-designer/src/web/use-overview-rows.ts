import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useQuery } from "@cosmicdrift/kumiko-renderer";
import { type OverviewRowView, parseOverviewRow } from "./overview-row.ts";

type OverviewResponse = { readonly rows: readonly Readonly<Record<string, unknown>>[] };

export type OverviewRows = {
  readonly rows: readonly OverviewRowView[];
  readonly loaded: boolean;
  readonly refetch: () => Promise<void>;
};

// One overview row per slug and kind; the filter is applied on the server.
export function useOverviewRows(kind: string, search?: string): OverviewRows {
  const query = useQuery<OverviewResponse>(TemplateResolverQueries.overview, {
    filters: [{ field: "kind", op: "in", value: [kind] }],
    limit: 200,
    ...(search !== undefined && { search }),
  });
  return {
    rows: (query.data?.rows ?? []).flatMap((row) => parseOverviewRow(row) ?? []),
    loaded: query.data !== null,
    refetch: async () => {
      await query.refetch();
    },
  };
}
