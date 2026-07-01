import { rowMetaFieldNames } from "../../db/table-builder";
import { SETTINGS_HUB_AUDIENCE_NAV_QNS } from "../build-config-feature-schema";
import { qualifyEntityName } from "../qualified-name";
import { getAllowedFilterOps, isFieldFilterable } from "../screen-filter-ops";
import type { FeatureDefinition, NavDefinition, WorkspaceDefinition } from "../types";
import type { FieldCondition, RowAction, RowFieldExtractor, ToolbarAction } from "../types/screen";
import { isExtensionEditSection, normalizeEditField, normalizeListColumn } from "../types/screen";

// --- Screen validation ---
//
// For every r.screen() declaration check what's locally knowable at boot:
//   - entityList / entityEdit: the referenced entity must exist in the
//     feature (cross-feature entity-refs aren't allowed — a feature owns
//     the screens over its own entities) and every column/field ref must
//     name a real field on that entity
//   - custom: the renderer must at least have one platform component set
//     (react OR native), otherwise the screen is structurally empty
//
// Field-level renderer QN strings (cross-feature `component:` references)
// are NOT validated here — the r.uiComponent registry that would resolve
// them ships in M4/M5. Until then those are kept opaque on purpose.

// Tier 2.7e-3: deklarative Feld-Referenzen einer Action gegen die Entity-
// Felder pinnen — ein Tippfehler in pick/map-Quellfeldern oder
// visible.field erzeugte sonst still `undefined` im Payload bzw. dauerhaft
// falsche Sichtbarkeit (gleiche "Typo fällt erst beim Klick"-Klasse wie
// navigate/handler).
function validateActionFieldRefs(
  featureName: string,
  screenId: string,
  actionKind: "rowAction" | "toolbarAction",
  actionId: string,
  action: RowAction | ToolbarAction,
  fieldNames: ReadonlySet<string>,
  rowMeta: ReadonlySet<string>,
): void {
  // ToolbarAction.payload ist ein STATISCHER Record (kein Row-Context) —
  // nur echte pick/map-Extractoren werden gegen die Feldnamen geprüft.
  const isExtractor = (v: unknown): v is RowFieldExtractor =>
    typeof v === "object" && v !== null && ("pick" in v || "map" in v);
  const payload = "payload" in action && isExtractor(action.payload) ? action.payload : undefined;
  const params = "params" in action && isExtractor(action.params) ? action.params : undefined;
  const visible: FieldCondition | undefined = "visible" in action ? action.visible : undefined;
  const entityId: string | undefined = "entityId" in action ? action.entityId : undefined;
  const known = () => [...fieldNames].sort().join(", ") || "(none)";
  const checkExtractor = (label: string, extractor: RowFieldExtractor | undefined): void => {
    // skip: extractor ist ein optionaler Action-Slot — ohne ihn gibt es
    // keine Feld-Referenzen zu validieren.
    if (extractor === undefined) {
      return;
    }
    const sources = "pick" in extractor ? extractor.pick : Object.values(extractor.map);
    for (const source of sources) {
      if (rowMeta.has(source)) continue;
      if (!fieldNames.has(source)) {
        throw new Error(
          `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
            `${label} references unknown field "${source}". Known fields: ${known()}.`,
        );
      }
    }
  };
  checkExtractor("payload", payload);
  checkExtractor("params", params);
  if (
    visible !== undefined &&
    typeof visible !== "boolean" &&
    !rowMeta.has(visible.field) &&
    !fieldNames.has(visible.field)
  ) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
        `visible.field references unknown field "${visible.field}". Known fields: ${known()}.`,
    );
  }
  if (entityId !== undefined && entityId !== "id" && !fieldNames.has(entityId)) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" ${actionKind} "${actionId}" ` +
        `entityId references unknown field "${entityId}". Known fields: ${known()}.`,
    );
  }
}

export function validateScreens(
  feature: FeatureDefinition,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
  allWriteHandlerQns: ReadonlySet<string>,
  allScreenQns: ReadonlySet<string>,
  allConfigKeyQns: ReadonlySet<string>,
): void {
  // navigate-Targets (rowAction/toolbarAction) dürfen cross-feature zeigen —
  // der Runtime-Router (create-app) löst eine bare screenId app-weit über ALLE
  // Features auf (eine deklarative Liste im owning-Feature der Entity navigiert
  // so zu den Custom-Editoren der Consumer-App). Der Validator spiegelt das:
  // same-feature ODER irgendein Feature. (redirect/cancelTarget bleiben bewusst
  // same-feature: deren Router baut die URL direkt aus der kurzen id.)
  const navTargetShortIds = screenShortIdsFrom(allScreenQns);
  for (const [screenId, screen] of Object.entries(feature.screens)) {
    if (screen.type === "custom") {
      if (!screen.renderer.react && !screen.renderer.native) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" has type="custom" but the renderer ` +
            `declares neither a react nor a native component — at least one platform must be set.`,
        );
      }
      continue;
    }

    if (screen.type === "configEdit") {
      // configEdit: layout/fields wie actionForm validieren, plus
      // Cross-Check dass jeder qualifizierte Config-Key registriert
      // ist und der scope mit dem Key matcht.
      const fieldNames = new Set(Object.keys(screen.fields));
      if (fieldNames.size === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has empty fields map — ` +
            `declare at least one field.`,
        );
      }
      for (const [fname, fdef] of Object.entries(screen.fields)) {
        // @cast-boundary schema-walk — feature-config inspection
        const ftype = (fdef as { type?: unknown }).type;
        if (typeof ftype !== "string" || ftype.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" has no ` +
              `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
          );
        }
      }
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (isExtensionEditSection(section)) {
          if (section.component?.react === undefined && section.component?.native === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (configEdit) extension section ` +
                `"${section.title}" has no component — declare a react/native component marker.`,
            );
          }
          continue;
        }
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (configEdit) layout references unknown ` +
                `field "${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
            );
          }
        }
      }
      // configKeys: jeder fieldName muss einen Mapping-Eintrag haben,
      // jeder qualifizierte Key muss in der Registry existieren.
      for (const fname of fieldNames) {
        const qualified = screen.configKeys[fname];
        if (qualified === undefined) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" hat ` +
              `keinen Eintrag in configKeys-Map. Jedes deklarierte Field braucht ein Mapping zu ` +
              `einem qualifizierten Config-Key (\`<feature>:config:<short>\`).`,
          );
        }
        if (!allConfigKeyQns.has(qualified)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (configEdit) field "${fname}" → ` +
              `Config-Key "${qualified}" ist in keiner Feature-Registry deklariert. Tippfehler? ` +
              `Erwartetes Format: "<feature>:config:<short>". Bekannte Keys: ${
                [...allConfigKeyQns].sort().join(", ") || "(keine)"
              }`,
          );
        }
      }
      continue;
    }

    if (screen.type === "actionForm") {
      // Tier 2.7d: Action-Form-Screens haben keinen entity-Link, nur
      // einen Write-Handler-QN + Inline-Fields. Sechs Author-Code-
      // Checks am Boot:
      //   1) handler ist non-empty String.
      //   2) handler ist als Write-Handler registriert (cross-feature-
      //      Lookup gegen die collected QN-Map). Tippfehler/umbenannte
      //      Handler fallen sonst erst beim ersten Klick als 404 auf.
      //   3) fields-Map ist non-empty.
      //   4) Jeder Field-Eintrag hat einen `type`-Discriminator
      //      (Tippfehler in Schema → Renderer crasht stumm sonst).
      //   5) layout.sections + jedes referenced field existiert in
      //      fields.
      //   6) redirect (wenn gesetzt) verweist auf einen registrierten
      //      Screen-QN (Cross-Feature ok).
      if (!screen.handler || typeof screen.handler !== "string") {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has empty or non-string handler.`,
        );
      }
      if (!allWriteHandlerQns.has(screen.handler)) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) handler "${screen.handler}" ` +
            `is not a registered write-handler. Check the QN spelling (expected ` +
            `"<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
        );
      }
      const fieldNames = new Set(Object.keys(screen.fields));
      if (fieldNames.size === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has empty fields map — ` +
            `declare at least one field.`,
        );
      }
      // Jeder Field-Eintrag muss einen `type`-Discriminator haben.
      // Author-Tippfehler (`title: { required: true }` ohne type) →
      // RenderField fällt zur Laufzeit auf den Default-Renderer und
      // schickt einen leeren String — silent broken. Boot-Fail ist
      // klarer. `type as unknown` weil FieldDefinition als Union nur
      // bekannte Strings erlaubt; wir prüfen Author-Code, der ggf.
      // den Type-Check umgangen hat.
      for (const [fname, fdef] of Object.entries(screen.fields)) {
        // @cast-boundary schema-walk — feature-config inspection (Author may circumvent type-check)
        const ftype = (fdef as { type?: unknown }).type;
        if (typeof ftype !== "string" || ftype.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) field "${fname}" has no ` +
              `\`type\` set. Each field must declare a type (e.g. "text", "number", "select").`,
          );
        }
      }
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (isExtensionEditSection(section)) {
          if (section.component?.react === undefined && section.component?.native === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (actionForm) extension section ` +
                `"${section.title}" has no component — declare a react/native component marker.`,
            );
          }
          continue;
        }
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (actionForm) layout references unknown field ` +
                `"${normalized.field}". Known fields: ${[...fieldNames].sort().join(", ")}`,
            );
          }
        }
      }
      if (screen.redirect !== undefined) {
        // redirect ist die kurze Screen-ID (z.B. "item-list"); der
        // nav-Router resolved sie beim Mount gegen die Schema-Map.
        // Cross-Feature-Redirect ist nicht supported — der nav-Router
        // baut die URL aus screenId direkt, eine voll-QN würde als
        // `/shop:screen:foo/` landen und nirgendwo greifen.
        const candidateQn = qualifyEntityName(feature.name, "screen", screen.redirect);
        if (!allScreenQns.has(candidateQn)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) redirect "${screen.redirect}" ` +
              `does not resolve to a registered screen in this feature. Known screens: ${
                [...Object.keys(feature.screens)].sort().join(", ") || "(none)"
              }.`,
          );
        }
      }
      if (typeof screen.cancelTarget === "string") {
        // Gleiche Regel wie redirect — `false` (kein Cancel-Button)
        // braucht keine Validierung.
        const candidateQn = qualifyEntityName(feature.name, "screen", screen.cancelTarget);
        if (!allScreenQns.has(candidateQn)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (actionForm) cancelTarget "${screen.cancelTarget}" ` +
              `does not resolve to a registered screen in this feature. Known screens: ${
                [...Object.keys(feature.screens)].sort().join(", ") || "(none)"
              }.`,
          );
        }
      }
      continue;
    }

    // entityList / entityEdit: entity-refs are feature-local.
    const entityDef = feature.entities?.[screen.entity];
    if (!entityDef) {
      const known =
        Object.keys(feature.entities ?? {})
          .sort()
          .join(", ") || "(none)";
      const crossFeature = findEntityFeature(screen.entity, featureMap);
      const hint = crossFeature
        ? ` Entity "${screen.entity}" is owned by feature "${crossFeature}" — cross-feature screen ownership is not supported.`
        : "";
      throw new Error(
        `[Feature ${feature.name}] Screen "${screenId}" references entity "${screen.entity}" ` +
          `which is not declared in this feature (known: ${known}).${hint}`,
      );
    }

    const fieldNames = new Set(Object.keys(entityDef.fields));
    // List columns may also name a read-time derived field (not a stored
    // column). Allowed for display; deliberately NOT added to `fieldNames`, so
    // defaultSort/filter on a derived field still fails — server-side sort over
    // a non-column is a silent no-op (see DerivedFieldDef).
    const columnFieldNames =
      entityDef.derivedFields !== undefined
        ? new Set([...fieldNames, ...Object.keys(entityDef.derivedFields)])
        : fieldNames;
    const rowMeta = rowMetaFieldNames(entityDef.softDelete ?? false);
    if (screen.type === "entityList") {
      // Empty column list would render as a blank table — almost always the
      // sign of an in-progress screen the author forgot to fill in. Fail
      // loud: ui-core's computeListViewModel can't do anything useful with
      // zero columns either.
      if (screen.columns.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityList) has an empty columns list — ` +
            `declare at least one column.`,
        );
      }
      for (const col of screen.columns) {
        const normalized = normalizeListColumn(col);
        // A labeled column whose field is not an entity field is a *virtual*
        // presentational column (drawn by a columnRenderer component from the
        // row, e.g. tag chips) — its `field` is just a column key. Only an
        // unlabeled unknown field is an author typo worth failing the boot.
        if (!columnFieldNames.has(normalized.field) && normalized.label === undefined) {
          throw new Error(
            buildUnknownFieldMessage(
              feature.name,
              screenId,
              normalized.field,
              screen.entity,
              columnFieldNames,
            ),
          );
        }
        validateColumnRendererForm(feature.name, screenId, normalized);
      }
      // Pagination/Sort/Search-Validierung: Author-Fehler beim Boot
      // fangen, damit kein "warum kommt die Liste leer / falsch
      // sortiert"-Debug-Cycle zur Laufzeit losgeht.
      if (screen.pageSize !== undefined && screen.pageSize <= 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityList) has pageSize=${screen.pageSize} — ` +
            `must be a positive integer.`,
        );
      }
      if (screen.defaultSort !== undefined) {
        const sortField = screen.defaultSort.field;
        if (!fieldNames.has(sortField)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) defaultSort references unknown ` +
              `field "${sortField}". Known fields: ${[...fieldNames].sort().join(", ")}`,
          );
        }
        // sortable: true Pflicht — verhindert dass das UI auf einer
        // Spalte sortiert, die Server-Side gar keinen DB-Index hat
        // oder im Schema absichtlich nicht sortiert werden soll
        // (Audit-Felder, Computed-Werte). `sortable` lebt heute nur
        // auf TextFieldDef; "in"-narrow lässt das auch für andere
        // Field-Types ohne explizites Flag durchfallen, was ok ist:
        // Number/Date sind natürlich sortierbar, der Author kann sie
        // im Author-Code als sortable markieren wenn das Field-Type
        // es trägt (Erweiterung folgt).
        const fieldDef = entityDef.fields[sortField];
        const isSortable =
          fieldDef !== undefined && "sortable" in fieldDef && fieldDef.sortable === true;
        if (!isSortable) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) defaultSort.field "${sortField}" ` +
              `is not sortable. Set sortable: true on the field definition or pick another field.`,
          );
        }
      }
      // Screen-Filter (Tier 2.7c) — drei Layer Author-Code-Check:
      //   1) Field existiert auf der Entity (Tippfehler = leere Liste
      //      statt Crash; Boot-Fail ist deutlich besser).
      //   2) Field hat `filterable: true` (Author opt-in, analog zu
      //      `sortable`). Verhindert dass Audit-/Computed-/encrypted-
      //      Felder unbeabsichtigt filterbar werden.
      //   3) Op passt zum Field-Type. Lt/gt auf text-Feldern → Boot-
      //      Fail mit Hinweis statt String-Sort-Surprise zur Laufzeit.
      // Außerdem: "in" verlangt readonly Array.
      if (screen.filter !== undefined) {
        const filterField = screen.filter.field;
        if (!fieldNames.has(filterField)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter references unknown ` +
              `field "${filterField}". Known fields: ${[...fieldNames].sort().join(", ")}`,
          );
        }
        const fieldDef = entityDef.fields[filterField];
        if (fieldDef !== undefined && !isFieldFilterable(fieldDef)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter references field ` +
              `"${filterField}" which is not filterable. Set filterable: true on the field ` +
              `definition or pick another field.`,
          );
        }
        if (fieldDef !== undefined) {
          const allowedOps = getAllowedFilterOps(fieldDef);
          if (!allowedOps.includes(screen.filter.op)) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter.op ` +
                `"${screen.filter.op}" is not allowed on field "${filterField}" ` +
                `(type "${fieldDef.type}"). Allowed ops: ${allowedOps.join(", ") || "(none)"}.`,
            );
          }
        }
        if (screen.filter.op === "in" && !Array.isArray(screen.filter.value)) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) filter.op "in" requires ` +
              `filter.value to be a readonly array.`,
          );
        }
      }
      // Tier 2.7e-1: rowActions pinnen — navigate-target existiert (selbes
      // Feature), writeHandler-QN ist registriert. Tippfehler fallen sonst
      // erst beim ersten Klick als "Screen not found" / 404 auf.
      if (screen.rowActions !== undefined) {
        for (const action of screen.rowActions) {
          if (action.kind === "navigate") {
            const candidateQn = qualifyEntityName(feature.name, "screen", action.screen);
            if (!allScreenQns.has(candidateQn) && !navTargetShortIds.has(action.screen)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) rowAction "${action.id}" ` +
                  `navigate-target "${action.screen}" does not resolve to a registered screen in any feature.`,
              );
            }
          } else {
            if (!allWriteHandlerQns.has(action.handler)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) rowAction "${action.id}" ` +
                  `handler "${action.handler}" is not a registered write-handler. Check the QN spelling ` +
                  `(expected "<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
              );
            }
          }
          validateActionFieldRefs(
            feature.name,
            screenId,
            "rowAction",
            action.id,
            action,
            fieldNames,
            rowMeta,
          );
        }
        const rowClickActions = screen.rowActions.filter(
          (a) => a.kind === "navigate" && a.rowClick === true,
        );
        if (rowClickActions.length > 1) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityList) has ${rowClickActions.length} ` +
              "rowActions marked rowClick:true — at most one may fire on a row-body click.",
          );
        }
      }
      // Tier 2.7e-2: toolbarActions — analog zu rowActions, aber bisher
      // ohne Validator. Typo'd navigate-targets und unregistrierte
      // writeHandler-QNs fallen bis hierhin erst beim Klick auf.
      if (screen.toolbarActions !== undefined) {
        for (const action of screen.toolbarActions) {
          if (action.kind === "navigate") {
            const candidateQn = qualifyEntityName(feature.name, "screen", action.screen);
            if (!allScreenQns.has(candidateQn) && !navTargetShortIds.has(action.screen)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) toolbarAction "${action.id}" ` +
                  `navigate-target "${action.screen}" does not resolve to a registered screen in any feature.`,
              );
            }
          } else {
            if (!allWriteHandlerQns.has(action.handler)) {
              throw new Error(
                `[Feature ${feature.name}] Screen "${screenId}" (entityList) toolbarAction "${action.id}" ` +
                  `handler "${action.handler}" is not a registered write-handler. Check the QN spelling ` +
                  `(expected "<feature>:write:<short>") and that the handler is declared via r.writeHandler(...).`,
              );
            }
          }
          validateActionFieldRefs(
            feature.name,
            screenId,
            "toolbarAction",
            action.id,
            action,
            fieldNames,
            rowMeta,
          );
        }
      }
    } else {
      // Same rationale as the columns check: an entityEdit layout with zero
      // sections (or sections without any fields) renders as nothing — reject
      // at boot so the author sees it before the blank form surprises them.
      if (screen.layout.sections.length === 0) {
        throw new Error(
          `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) has an empty sections list — ` +
            `declare at least one section.`,
        );
      }
      for (const section of screen.layout.sections) {
        if (isExtensionEditSection(section)) {
          if (section.component?.react === undefined && section.component?.native === undefined) {
            throw new Error(
              `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) extension section ` +
                `"${section.title}" has no component — declare a react/native component marker.`,
            );
          }
          continue;
        }
        if (section.fields.length === 0) {
          throw new Error(
            `[Feature ${feature.name}] Screen "${screenId}" (entityEdit) has a section "${section.title}" ` +
              `with zero fields — drop the section or add fields to it.`,
          );
        }
        for (const fieldSpec of section.fields) {
          const normalized = normalizeEditField(fieldSpec);
          if (!fieldNames.has(normalized.field)) {
            throw new Error(
              buildUnknownFieldMessage(
                feature.name,
                screenId,
                normalized.field,
                screen.entity,
                fieldNames,
              ),
            );
          }
        }
      }
    }
  }
}

// Form-check für ListColumn-Renderer in der PlatformComponent-Form
// (`{ react: { __component: "Name" } }`). Der Server kennt die client-
// seitige columnRenderers-Map nicht — also nur prüfen ob die Struktur
// stimmt: wenn `react` als Object gesetzt ist, MUSS `__component` ein
// nicht-leerer String sein. Ein client-seitig ausgelassener Key löst
// nur eine Warnung aus, kein Boot-Fail.
export function validateColumnRendererForm(
  featureName: string,
  screenId: string,
  column: { readonly field: string; readonly renderer?: unknown },
): void {
  const renderer = column.renderer;
  // skip: nur die PlatformComponent-Form ({ react: { __component: "..." } })
  // wird strukturell validiert. Funktions-, String-QN- und null/undefined-
  // Renderer sind alle gültige andere Formen — kein Form-Fehler.
  if (renderer === null || typeof renderer !== "object") return;
  // @cast-boundary schema-walk — feature-config renderer-shape introspection
  const react = (renderer as { react?: unknown }).react;
  // skip: kein react-Branch → entweder native-only oder kein
  // PlatformComponent — beides außerhalb dieses Checks.
  if (react === undefined || react === null) return;
  if (typeof react !== "object") {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" column "${column.field}" has a renderer with ` +
        `a non-object \`react\` branch — expected \`{ react: { __component: "Name" } }\`.`,
    );
  }
  // @cast-boundary schema-walk — feature-config react-branch introspection
  const component = (react as { __component?: unknown }).__component;
  // skip: ohne __component-Schlüssel ist das keine String-Key-Form
  // (z.B. ein zukünftiger direkter Component-Ref); nicht unsere Domäne.
  if (component === undefined) return;
  if (typeof component !== "string" || component.length === 0) {
    throw new Error(
      `[Feature ${featureName}] Screen "${screenId}" column "${column.field}" has a renderer with ` +
        `\`react.__component\` = ${JSON.stringify(component)} — expected a non-empty string identifying ` +
        `a client-side columnRenderers entry.`,
    );
  }
}

export function findEntityFeature(
  entityName: string,
  featureMap: ReadonlyMap<string, FeatureDefinition>,
): string | undefined {
  for (const [name, feature] of featureMap) {
    if (feature.entities?.[entityName]) return name;
  }
  return undefined;
}

export function buildUnknownFieldMessage(
  featureName: string,
  screenId: string,
  fieldName: string,
  entityName: string,
  knownFields: ReadonlySet<string>,
): string {
  const known = [...knownFields].sort().join(", ");
  return (
    `[Feature ${featureName}] Screen "${screenId}" references field "${fieldName}" ` +
    `which does not exist on entity "${entityName}" (known: ${known}).`
  );
}

// --- Nav validation ---
//
// The boot-validator runs BEFORE createRegistry builds the final maps, so we
// pre-build the qualified name sets for screens + navs here. `qualifyEntityName`
// is the shared helper with the registry — changing the qualification rule
// in one place flows through both ingest paths.

export function collectScreenQns(features: readonly FeatureDefinition[]): Set<string> {
  const set = new Set<string>();
  for (const f of features) {
    for (const screenId of Object.keys(f.screens)) {
      set.add(qualifyEntityName(f.name, "screen", screenId));
    }
  }
  return set;
}

// Bare Screen-ids (ohne `<feature>:screen:`-Prefix) aus den qualifizierten
// QNs — für die app-weite Auflösung von navigate-Targets (s. validateScreens).
// Spiegelt den Runtime-Router, der bare ids feature-übergreifend matcht.
export function screenShortIdsFrom(allScreenQns: ReadonlySet<string>): Set<string> {
  const marker = ":screen:";
  const set = new Set<string>();
  for (const qn of allScreenQns) {
    const at = qn.indexOf(marker);
    if (at !== -1) set.add(qn.slice(at + marker.length));
  }
  return set;
}

// Sammelt alle qualifizierten Write-Handler-QNs (`<feature>:write:<short>`).
// Wird vom actionForm-Screen-Validator genutzt um zu prüfen ob der
// im Schema deklarierte handler tatsächlich registriert ist —
// Tippfehler/umbenannte Handler fallen sonst erst zur Laufzeit auf.
export function collectWriteHandlerQns(features: readonly FeatureDefinition[]): Set<string> {
  const set = new Set<string>();
  for (const f of features) {
    for (const handlerName of Object.keys(f.writeHandlers)) {
      set.add(qualifyEntityName(f.name, "write", handlerName));
    }
  }
  return set;
}

export function collectNavQns(
  features: readonly FeatureDefinition[],
): Map<string, NavDefinition & { readonly featureName: string }> {
  const map = new Map<string, NavDefinition & { readonly featureName: string }>();
  for (const f of features) {
    for (const [navId, navDef] of Object.entries(f.navs)) {
      const qualified = qualifyEntityName(f.name, "nav", navId);
      map.set(qualified, { ...navDef, featureName: f.name });
    }
  }
  return map;
}

// Per-feature ref validation: screen + parent refs point at real QNs. Cycle
// detection runs once globally afterwards (it's cheaper to do a single DFS
// over the merged graph than restart it per feature).
export function validateNavs(
  feature: FeatureDefinition,
  allScreenQns: ReadonlySet<string>,
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
  allWorkspaceQns: ReadonlyMap<string, WorkspaceDefinition & { readonly featureName: string }>,
): void {
  for (const [navId, navDef] of Object.entries(feature.navs)) {
    if (navDef.screen !== undefined && !allScreenQns.has(navDef.screen)) {
      throw new Error(
        `[Feature ${feature.name}] Nav entry "${navId}" references screen "${navDef.screen}" ` +
          `which is not registered. Expected a qualified name of the form ` +
          `"<feature>:screen:<id>" pointing at an r.screen() declaration.`,
      );
    }
    if (navDef.parent !== undefined && !allNavQns.has(navDef.parent)) {
      throw new Error(
        `[Feature ${feature.name}] Nav entry "${navId}" references parent "${navDef.parent}" ` +
          `which is not a registered nav entry. Expected a qualified name of the form ` +
          `"<feature>:nav:<id>".`,
      );
    }
    if (navDef.workspaces !== undefined) {
      for (const wsQn of navDef.workspaces) {
        if (!allWorkspaceQns.has(wsQn)) {
          throw new Error(
            `[Feature ${feature.name}] Nav entry "${navId}" self-assigns to workspace "${wsQn}" ` +
              `which is not registered. Expected a qualified name of the form ` +
              `"<feature>:workspace:<id>" pointing at an r.workspace() declaration.`,
          );
        }
      }
    }
  }
}

// Walks parent-refs across ALL nav entries (cross-feature). A cycle here
// would crash client-side tree assembly — easier to fail loud at boot than
// to debug a React "Maximum update depth exceeded" stack trace.
export function validateNavCycles(
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
): void {
  const visited = new Set<string>();
  const stack = new Set<string>();

  function visit(qualified: string, path: string[]): void {
    if (stack.has(qualified)) {
      throw new Error(
        `[Kumiko Nav] Nav entry parent cycle detected: ${[...path, qualified].join(" → ")}`,
      );
    }
    // skip: already visited — cycle-detection only needs to traverse each
    // node once, and the `stack` check above catches any actual cycles
    // reached via a different path.
    if (visited.has(qualified)) return;
    visited.add(qualified);
    stack.add(qualified);
    const navDef = allNavQns.get(qualified);
    if (navDef?.parent) {
      visit(navDef.parent, [...path, qualified]);
    }
    stack.delete(qualified);
  }

  for (const qualified of allNavQns.keys()) {
    visit(qualified, []);
  }
}

// Roles we recognise at boot time. The framework has no explicit
// role-registry (r.defineRoles is a type helper only), so we synthesise
// one from every handler-access rule plus the "all"/"system" built-ins.
export function collectKnownRoles(features: readonly FeatureDefinition[]): Set<string> {
  const roles = new Set<string>(["all", "system"]);
  for (const f of features) {
    for (const def of Object.values(f.writeHandlers)) {
      if (def.access && "roles" in def.access) {
        for (const r of def.access.roles) roles.add(r);
      }
    }
    for (const def of Object.values(f.queryHandlers)) {
      if (def.access && "roles" in def.access) {
        for (const r of def.access.roles) roles.add(r);
      }
    }
  }
  return roles;
}

// --- Workspace validation ---
//
// Per-app workspace registry, built once up front. Carries `featureName`
// alongside the definition so error messages can point at the offending
// feature without a parallel reverse index.

export function collectWorkspaceQns(
  features: readonly FeatureDefinition[],
): Map<string, WorkspaceDefinition & { readonly featureName: string }> {
  const map = new Map<string, WorkspaceDefinition & { readonly featureName: string }>();
  for (const f of features) {
    for (const [wsId, wsDef] of Object.entries(f.workspaces)) {
      const qualified = qualifyEntityName(f.name, "workspace", wsId);
      map.set(qualified, { ...wsDef, featureName: f.name });
    }
  }
  return map;
}

export function validateWorkspaces(
  feature: FeatureDefinition,
  allNavQns: ReadonlyMap<string, NavDefinition & { readonly featureName: string }>,
): void {
  for (const [wsId, wsDef] of Object.entries(feature.workspaces)) {
    if (wsDef.nav !== undefined) {
      for (const navQn of wsDef.nav) {
        // Settings-Hub audience navs are generated post-boot (buildAppSchema), never via r.nav() — exempt so an inline-placement reference doesn't trip the boot validator.
        if (SETTINGS_HUB_AUDIENCE_NAV_QN_SET.has(navQn)) continue;
        if (!allNavQns.has(navQn)) {
          throw new Error(
            `[Feature ${feature.name}] Workspace "${wsId}" references nav "${navQn}" ` +
              `which is not registered. Expected a qualified name of the form ` +
              `"<feature>:nav:<id>" pointing at an r.nav() declaration.`,
          );
        }
      }
    }
  }
}

const SETTINGS_HUB_AUDIENCE_NAV_QN_SET: ReadonlySet<string> = new Set(
  SETTINGS_HUB_AUDIENCE_NAV_QNS,
);

// Single-default rule across the entire app. Mirrors how createApp validates
// roles up front — a second `default: true` is a configuration error, not a
// runtime fallback. Apps without any default fall back to "first workspace
// the user has access to" at render time (handled by shellWorkspaces).
export function validateDefaultWorkspaceUniqueness(
  allWorkspaceQns: ReadonlyMap<string, WorkspaceDefinition & { readonly featureName: string }>,
): void {
  const defaults: string[] = [];
  for (const [qn, ws] of allWorkspaceQns) {
    if (ws.default === true) defaults.push(qn);
  }
  if (defaults.length > 1) {
    throw new Error(
      `[Kumiko Workspaces] Multiple workspaces declare default: true — ` +
        `${defaults.join(", ")}. At most one workspace per app may be the default.`,
    );
  }
}
