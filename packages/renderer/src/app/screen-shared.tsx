import type {
  ActionFormRedirect,
  ActionFormScreenDefinition,
  ActionFormSuccessLink,
  ScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { extractIdField } from "../components/reference-create-dialog.tsx";
import { rendererWarn } from "../dev-console.ts";
import type { Dispatcher, Translate } from "../headless/index.ts";
import { applyFormatSpec } from "../headless/index.ts";
import { REFERENCE_LIST_LOOKUP_LIMIT } from "../hooks/reference-limits.ts";
import { type ListSort, PAGE_SIZE_OPTIONS } from "../hooks/use-list-url-state.ts";
import { referenceLookupSource } from "../hooks/use-reference-lookup.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import type { ResolvedSuccessLink } from "./action-form-support.tsx";
import { ISO_DATE_PATTERN, isMoneyValue } from "./entity-edit-prefill.ts";
import type { FeatureSchema } from "./feature-schema.ts";
import { type NavApi, type ScreenTarget, useNav } from "./nav.tsx";
import { lastSegment, toKebab } from "./qn.ts";
import { featureNameFromQualifiedScreenId } from "./qualify-screen-id.ts";
import { navigateToReturn, navigateWithReturnTo, useReturnHost } from "./return-to.tsx";

function ScreenMissingHomeButton({
  homeScreenId,
  testId,
}: {
  readonly homeScreenId: string;
  readonly testId: string;
}): ReactNode {
  const { Button } = usePrimitives();
  const t = useTranslation();
  const nav = useNav();
  return (
    <Button
      variant="secondary"
      onClick={() => nav.navigate({ screenId: homeScreenId })}
      testId={testId}
    >
      {t("kumiko.screen-missing.home")}
    </Button>
  );
}

/** Empty state for a screen QN that is not in the schema (feature disabled for
 *  the tenant, stale link, miswired screen). The QN only goes to the console. */
export function ScreenMissingState({
  screenQn,
  homeScreenId,
  testId = "kumiko-screen-not-found",
}: {
  readonly screenQn: string;
  readonly homeScreenId?: string;
  readonly testId?: string;
}): ReactNode {
  const { Card, Text } = usePrimitives();
  const t = useTranslation();
  useEffect(() => {
    rendererWarn(
      `[kumiko] screen "${screenQn}" is not in the schema (feature disabled, stale link or miswired screen).`,
    );
  }, [screenQn]);
  return (
    <Card
      options={{ padded: true }}
      slots={{
        title: <Text testId={`${testId}-title`}>{t("kumiko.screen-missing.title")}</Text>,
        subtitle: <Text variant="muted">{t("kumiko.screen-missing.hint")}</Text>,
      }}
      testId={testId}
    >
      {homeScreenId !== undefined ? (
        <ScreenMissingHomeButton homeScreenId={homeScreenId} testId={`${testId}-home`} />
      ) : null}
    </Card>
  );
}

export function ScreenAccessDeniedBanner({
  screenQn,
  testId,
}: {
  readonly screenQn: string;
  readonly testId: string;
}): ReactNode {
  const { Banner } = usePrimitives();
  const t = useTranslation();
  useEffect(() => {
    rendererWarn(`[kumiko] access to screen "${screenQn}" denied for the current roles.`);
  }, [screenQn]);
  return (
    <Banner padded variant="error" testId={testId}>
      {t("kumiko.screen-access-denied.title")}
    </Banner>
  );
}

// ---- entity-edit ----

// Derives `<feature>:write:<entity>:<verb>` from the screen's entity
// and the schema's feature name. Matches qualifyEntityName / toKebab in
// packages/framework/src/engine/qualified-name.ts so camelCase entity
// ids (e.g. driverModel) resolve to server QNs (driver-model:create).
export function entityWriteCommand(
  featureName: string,
  entity: string,
  verb: "create" | "update" | "delete",
): string {
  return `${toKebab(featureName)}:write:${toKebab(entity)}:${verb}`;
}

// Default "success -> back to the list" navigation. Finds the first
// entityList screen for the entity and navigates there. Create, update and
// delete all use it: each of them ends with "done editing, leave" as the
// sensible default.
export function findEntityListScreen(
  schema: FeatureSchema,
  entityName: string,
): ScreenDefinition | undefined {
  return schema.screens.find(
    (s: ScreenDefinition) => s.type === "entityList" && s.entity === entityName,
  );
}

// Unknown or deleted record id: a localized empty state with a way back
// instead of a bare error banner. Composed from shared primitives so web and
// native render it alike.
export function RecordNotFoundState({
  translate,
  onBack,
}: {
  readonly translate: Translate;
  readonly onBack?: () => void;
}): ReactNode {
  const { Card, Text, Button } = usePrimitives();
  return (
    <Card options={{ padded: true }} testId="kumiko-screen-record-missing">
      <Text testId="kumiko-screen-record-missing-title">
        {translate("kumiko.record.not-found.title")}
      </Text>
      <Text variant="muted">{translate("kumiko.record.not-found.hint")}</Text>
      {onBack !== undefined && (
        <Button variant="secondary" onClick={onBack} testId="kumiko-screen-record-missing-back">
          {translate("kumiko.record.not-found.back")}
        </Button>
      )}
    </Card>
  );
}

export function useNavigateToListAfter(schema: FeatureSchema, entityName: string): () => void {
  const nav = useNav();
  return useCallback(() => {
    const list = findEntityListScreen(schema, entityName);
    if (!list) return;
    // schema.screens.id is in QN form (registry-stamped); nav.navigate
    // expects the short form. Otherwise the URL ends up double-qualified.
    nav.navigate({ screenId: lastSegment(list.id) });
  }, [nav, schema, entityName]);
}

// Default "+ New" navigation for the list toolbar: finds the first
// entityEdit screen without an entityId attachment and navigates there.
// Returns undefined when no edit screen is registered, so RenderList
// renders no "+ New" button.
//
// Schema screens come from the registry with qualified ids
// ("publicstatus:screen:component-edit"); lastSegment strips the prefix
// for nav.navigate (see ./qn.ts).
export function pageSizeOptionsFor(currentLimit: number): readonly number[] {
  return PAGE_SIZE_OPTIONS.includes(currentLimit)
    ? PAGE_SIZE_OPTIONS
    : [...PAGE_SIZE_OPTIONS, currentLimit].sort((a, b) => a - b);
}

export function useNavigateToCreateFor(
  schema: FeatureSchema,
  entityName: string,
  createScreen?: string,
  createUnavailable?: boolean,
): (() => void) | undefined {
  const nav = useNav();
  const host = useReturnHost();
  const editScreenId = useMemo(() => {
    if (createScreen !== undefined) return createScreen;
    // The role may not open the declared create target; falling back to the
    // entity's edit form would bypass the flow the app prescribes (e.g. a wizard).
    if (createUnavailable === true) return undefined;
    // allowCreate:false = update-only edit screen (create runs through a
    // lifecycle write), so it is not a "+ New" target. singleton:true opens
    // the existing record without an entityId (EntityEditSingletonBody)
    // instead of an empty create form, so it does not count for the same reason.
    const edit = schema.screens.find(
      (s: ScreenDefinition) =>
        s.type === "entityEdit" &&
        s.entity === entityName &&
        s.allowCreate !== false &&
        s.singleton !== true,
    );
    return edit !== undefined ? lastSegment(edit.id) : undefined;
  }, [schema.screens, entityName, createScreen, createUnavailable]);
  const navigate = useCallback(() => {
    if (editScreenId !== undefined) navigateWithReturnTo(nav, { screenId: editScreenId }, host);
  }, [nav, editScreenId, host]);
  return editScreenId !== undefined ? navigate : undefined;
}

function formatSummaryValue(value: unknown, locale: string): string {
  if (isMoneyValue(value)) {
    return new Intl.NumberFormat(locale, { style: "currency", currency: value.currency }).format(
      value.amount,
    );
  }
  if (typeof value === "number") return applyFormatSpec({ format: "number", locale }, value);
  if (typeof value === "string" && ISO_DATE_PATTERN.test(value)) {
    return applyFormatSpec({ format: "date", locale }, value);
  }
  return value === null || value === undefined ? "" : String(value);
}

export function formatSummaryParams(
  prefill: Readonly<Record<string, unknown>> | undefined,
  locale: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(prefill ?? {}).map(([name, value]) => [name, formatSummaryValue(value, locale)]),
  );
}

// Placeholders of `successMessage`: formatted submitted values, with a
// reference field resolved to the chosen record's label. A lookup that fails or
// misses the row falls back to the raw id.
export async function resolveSuccessMessageParams(
  screen: ActionFormScreenDefinition,
  featureName: string,
  values: Readonly<Record<string, unknown>>,
  dispatcher: Dispatcher,
  locale: string,
): Promise<Record<string, string>> {
  const params = formatSummaryParams(values, locale);
  await Promise.all(
    Object.entries(screen.fields).map(async ([name, def]) => {
      const raw = values[name];
      if (def.type !== "reference" || typeof raw !== "string" || raw === "") return;
      const target = parseRefTarget(def.entity, featureName);
      const { queryQn, labelKey } = referenceLookupSource(
        target.featureName,
        target.entityName,
        def.labelField ?? "id",
      );
      // Ask for exactly the chosen record so it cannot fall beyond the lookup cap: `ids` is the
      // by-id input of directory sources, `filters` that of entity list handlers. A source that
      // knows neither returns its capped list and the scan below still finds the row if present.
      const lookup = await dispatcher.query<{ rows: ReadonlyArray<Record<string, unknown>> }>(
        queryQn,
        {
          limit: REFERENCE_LIST_LOOKUP_LIMIT,
          ids: [raw],
          filters: [{ field: "id", op: "in", value: [raw] }],
        },
      );
      if (!lookup.isSuccess) return;
      const row = lookup.data.rows.find((candidate) => candidate["id"] === raw);
      const label = row?.[labelKey];
      if (label !== undefined && label !== null) params[name] = String(label);
    }),
  );
  return params;
}

export function resolveActionFormSummary(
  summary: ActionFormScreenDefinition["summary"],
  prefill: Readonly<Record<string, unknown>> | undefined,
  translate: Translate,
  locale: string,
): { readonly title: string; readonly subtitle?: string } | undefined {
  if (summary === undefined) return undefined;
  const params = formatSummaryParams(prefill, locale);
  return {
    title: translate(summary.title, params),
    ...(summary.subtitle !== undefined && { subtitle: translate(summary.subtitle, params) }),
  };
}

// ---- entity-list ----

export function entityQueryCommand(featureName: string, entity: string, verb: "list"): string {
  return `${toKebab(featureName)}:query:${toKebab(entity)}:${verb}`;
}

// Server-side entity-query-handlers return the paged envelope
// `{ rows, nextCursor, total? }`. Narrow the useQuery generic to that
// shape so RenderList gets plain rows. `total` is optional: the server
// only returns it when the caller sets `totalCount: true`.
export type PagedRows = {
  readonly rows: Readonly<Record<string, unknown>>[];
  readonly nextCursor: string | null;
  readonly total?: number;
};

// Payload for the server-side list query handler (LIST_PAYLOAD_SCHEMA):
// search/sort/sortDirection/limit + offset/totalCount for pager mode OR
// cursor for infinite scroll. Shared by EntityListBody and
// ProjectionListBody so the two branches can't drift on this shape
// — entity-only additions (screen.filter, faceted filters) are
// layered on top by the caller instead of living in here.
export function buildListQueryPayload(state: {
  readonly limit: number;
  readonly search: string;
  readonly sort: ListSort | null;
  readonly usePager: boolean;
  readonly page: number;
  readonly useInfinite: boolean;
  readonly cursor: string | undefined;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { limit: state.limit };
  if (state.search !== "") payload["search"] = state.search;
  if (state.sort !== null) {
    payload["sort"] = state.sort.field;
    payload["sortDirection"] = state.sort.dir;
  }
  if (state.usePager) {
    // page=1 → offset=0, page=2 → offset=limit, etc. Server clamps itself
    // when offset >= total.
    const offset = (state.page - 1) * state.limit;
    if (offset > 0) payload["offset"] = offset;
    // totalCount: extra COUNT(*) so the pager can render "Page X of Y".
    payload["totalCount"] = true;
  } else if (state.useInfinite && state.cursor !== undefined) {
    payload["cursor"] = state.cursor;
  }
  return payload;
}

// ---- actionForm ----

type RedirectSpec = string | ActionFormRedirect | ActionFormSuccessLink;

export function redirectScreenTarget(redirect: RedirectSpec): string {
  return typeof redirect === "string" ? redirect : redirect.screen;
}

// Same-entity detection for navigate defaults: only an entityEdit screen of the
// SAME entity may receive the current record's id (it opens in UPDATE mode, which
// is what the boot validator assumes). Searched across all features.
export function isEntityEditScreenOfEntity(
  entity: string | undefined,
  targetScreen: string,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): boolean {
  if (entity === undefined) return false;
  return [schema, ...appFeatures].some((feature) =>
    feature.screens.some(
      (s) => s.type === "entityEdit" && s.entity === entity && lastSegment(s.id) === targetScreen,
    ),
  );
}

// Record-scoped targets (actionForm, secretMint) take the shown record's id; an
// entityEdit of ANOTHER entity must not, or it would open that entity's UPDATE
// mode on the wrong id instead of create.
export function isEntityEditScreenOfOtherEntity(
  entity: string,
  targetScreen: string,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): boolean {
  return [schema, ...appFeatures].some((feature) =>
    feature.screens.some(
      (s) => s.type === "entityEdit" && s.entity !== entity && lastSegment(s.id) === targetScreen,
    ),
  );
}

// A qualified redirect names its feature, so the search space is THAT feature
// only — the current schema's own screens must not shadow it with a same
// short-id screen of another type. An unqualified redirect searches this
// schema first (own screen wins), then every mounted feature. A named feature
// that isn't mounted (no provider / isolated test) falls back to this schema.
function findRedirectTargetScreen(
  redirect: RedirectSpec,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): ScreenDefinition | undefined {
  const redirectScreen = redirectScreenTarget(redirect);
  const targetId = lastSegment(redirectScreen);
  const targetFeatureName = featureNameFromQualifiedScreenId(redirectScreen);
  const targetFeature =
    targetFeatureName !== undefined
      ? appFeatures.find((f) => f.featureName === targetFeatureName)
      : undefined;
  const searchSpace =
    targetFeature !== undefined
      ? targetFeature.screens
      : targetFeatureName === undefined
        ? [...schema.screens, ...appFeatures.flatMap((f) => f.screens)]
        : schema.screens;
  return searchSpace.find((s) => lastSegment(s.id) === targetId);
}

// A redirect to a record screen ("show the result") is a deliberate forward
// navigation and keeps precedence over returnTo.
function redirectTargetsRecord(
  redirect: RedirectSpec,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): boolean {
  const target = findRedirectTargetScreen(redirect, schema, appFeatures);
  return (
    target !== undefined && (target.type === "entityEdit" || target.type === "projectionDetail")
  );
}

// Type-guard form narrows `returnTarget` for the caller's subsequent
// navigateToReturn(nav, returnTarget) call.
export function returnToWinsOverRedirect(
  returnTarget: ScreenTarget | undefined,
  redirect: string | ActionFormRedirect,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
): returnTarget is ScreenTarget {
  return returnTarget !== undefined && !redirectTargetsRecord(redirect, schema, appFeatures);
}

// Resolves an object-form redirect to a nav target — shared by
// actionForm and entityEdit (create + update) so the id
// carries over identically regardless of which screen type triggered it.
// `carriesId` gates entityId on the TARGET screen type: a redirect to a
// list screen never gets an id attached, matching actionForm's original
// behavior. The id itself prefers the write-handler's success payload
// (`submittedData`) and falls back to `fallbackRecord` — the entityEdit
// update path's already-loaded record, or the create path's just-submitted
// form values — both of which carry fields (e.g. a parent FK) the CRUD
// write executor's success payload doesn't flatly expose.
export function resolveRedirectTarget(
  redirect: RedirectSpec,
  submittedData: unknown,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
  fallbackRecord?: Readonly<Record<string, unknown>>,
): ResolvedRedirectTarget {
  const redirectScreen = redirectScreenTarget(redirect);
  const idField = typeof redirect === "string" ? "id" : (redirect.idFrom ?? "id");
  const targetId = lastSegment(redirectScreen);
  const target = findRedirectTargetScreen(redirect, schema, appFeatures);
  const carriesId =
    target !== undefined && (target.type === "entityEdit" || target.type === "projectionDetail");
  if (!carriesId) return { screenId: targetId, entityId: undefined, tab: undefined };
  const entityId =
    extractIdField(submittedData, idField) ??
    (fallbackRecord !== undefined ? extractIdField(fallbackRecord, idField) : undefined);
  return {
    screenId: targetId,
    entityId,
    tab: typeof redirect === "string" ? undefined : redirect.tab,
  };
}

type ResolvedRedirectTarget = {
  readonly screenId: string;
  readonly entityId: string | undefined;
  readonly tab: string | undefined;
};

export function navigateToRedirectTarget(nav: NavApi, target: ResolvedRedirectTarget): void {
  const navTarget = {
    screenId: target.screenId,
    ...(target.entityId !== undefined && { entityId: target.entityId }),
  };
  if (target.tab === undefined) nav.navigate(navTarget);
  else nav.navigate(navTarget, { searchParams: { tab: target.tab } });
}

// Links of the success box. Targets resolve like `redirect`; a link whose target
// needs a record id (entityEdit, projectionDetail) but whose payload field holds
// no string id is dropped instead of navigating to an id-less record screen.
// A link without idFrom to a non-record screen always navigates id-less.
export function resolveSuccessLinks(
  links: readonly ActionFormSuccessLink[] | undefined,
  data: unknown,
  schema: FeatureSchema,
  appFeatures: readonly FeatureSchema[],
  nav: NavApi,
  translate: Translate,
): readonly ResolvedSuccessLink[] {
  const resolved: ResolvedSuccessLink[] = [];
  (links ?? []).forEach((link, index) => {
    const target = resolveRedirectTarget(link, data, schema, appFeatures);
    if (target.entityId === undefined && redirectTargetsRecord(link, schema, appFeatures)) return;
    const navTarget = {
      screenId: target.screenId,
      ...(target.entityId !== undefined && { entityId: target.entityId }),
    };
    const options = target.tab === undefined ? undefined : { searchParams: { tab: target.tab } };
    resolved.push({
      key: String(index),
      label: translate(link.label),
      href: nav.hrefFor(navTarget, options),
      onPress: () => nav.navigate(navTarget, options),
    });
  });
  return resolved;
}

// Success navigation for a configured redirect — shared by entityEdit's
// save and writeHandler record actions. The string form navigates without an
// entityId; the object form resolves like actionForm's, with `record` as the
// fallback id source.
export function navigateAfterRedirect(options: {
  readonly nav: NavApi;
  readonly schema: FeatureSchema;
  readonly appFeatures: readonly FeatureSchema[];
  readonly returnTarget: ScreenTarget | undefined;
  readonly redirect: string | ActionFormRedirect;
  readonly resultData: unknown;
  readonly record: Readonly<Record<string, unknown>>;
}): void {
  const { nav, schema, appFeatures, returnTarget, redirect, resultData, record } = options;
  if (returnToWinsOverRedirect(returnTarget, redirect, schema, appFeatures)) {
    navigateToReturn(nav, returnTarget);
    return;
  }
  if (typeof redirect === "string") {
    nav.navigate({ screenId: lastSegment(redirect) });
    return;
  }
  navigateToRedirectTarget(
    nav,
    resolveRedirectTarget(redirect, resultData, schema, appFeatures, record),
  );
}

// A drawer is no navigation target, so returnTo does not apply. Redirecting onto the host
// screen would only reset its filters/scroll/tab; the drawer's close + refetch already refreshed it.
export function navigateAfterDrawerSubmit(options: {
  readonly nav: NavApi;
  readonly schema: FeatureSchema;
  readonly appFeatures: readonly FeatureSchema[];
  readonly redirect: string | ActionFormRedirect | undefined;
  readonly resultData: unknown;
}): void {
  const { nav, schema, appFeatures, redirect, resultData } = options;
  if (redirect === undefined) return;
  const target = resolveRedirectTarget(redirect, resultData, schema, appFeatures);
  const hostScreenId = nav.route === undefined ? undefined : lastSegment(nav.route.screenId);
  const isHostScreen =
    target.screenId === hostScreenId && target.entityId === undefined && target.tab === undefined;
  if (!isHostScreen) navigateToRedirectTarget(nav, target);
}

// The update payload nests the saved projection under `data`; a changed
// parent FK lives there, not in the pre-edit `record`.
export function overlayUpdatedProjection(
  record: Readonly<Record<string, unknown>>,
  resultData: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof resultData !== "object" || resultData === null) return record;
  const projection = propertyOf(resultData, "data");
  if (typeof projection !== "object" || projection === null) return record;
  return { ...record, ...projection };
}
