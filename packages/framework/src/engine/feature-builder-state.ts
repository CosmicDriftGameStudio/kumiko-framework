import type { ZodType, z } from "zod";
import { LifecycleHookTypes } from "./constants";
import type {
  AuthClaimsFn,
  BootCheckFn,
  ClaimKeyDefinition,
  ConfigKeyDefinition,
  ConfigSeedDef,
  EntityDefinition,
  EntityProjectionExtension,
  EventMigrationDef,
  ExtensionSelectorDef,
  FeatureMetricDef,
  JobDefinition,
  LifecycleHookFn,
  MultiStreamProjectionDefinition,
  NotificationDefinition,
  OwnedFn,
  PhasedHook,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  ProjectionDefinition,
  QueryHandlerDef,
  ReferenceDataDef,
  RegistrarExtensionDef,
  RegistrarExtensionRegistration,
  RelationDefinition,
  SearchPayloadContributorFn,
  SecretKeyDefinition,
  StoreTableEntry,
  TranslationKeys,
  TreeActionDef,
  UiHints,
  ValidationHookFn,
  WriteHandlerDef,
} from "./types";
import type { HttpRouteDefinition } from "./types/http-route";
import type { NavDefinition } from "./types/nav";
import type { ScreenDefinition } from "./types/screen";
import type { WorkspaceDefinition } from "./types/workspace";

const LIFECYCLE_TYPES = Object.values(LifecycleHookTypes);

// Bundles every Record/Set/array/scalar defineFeature populates while the
// registrar's ~40 methods run — hoisted out of defineFeature's closure so a
// future move-diff (extracting each method into its own module) can thread
// it explicitly. Every field is held BY REFERENCE — no destructured copies.
export type FeatureBuilderState = {
  requires: string[];
  optionalRequires: string[];
  requiredProjections: Set<string>;
  requiredSteps: Set<string>;
  entities: Record<string, EntityDefinition>;
  entityTables: Record<string, unknown>;
  relations: Record<string, Record<string, RelationDefinition>>;
  writeHandlers: Record<string, WriteHandlerDef>;
  queryHandlers: Record<string, QueryHandlerDef>;
  validationHooks: Record<string, ValidationHookFn>;
  lifecycleHooks: Record<string, Record<string, OwnedFn<LifecycleHookFn>[]>>;
  phasedLifecycleHooks: Record<
    "postSave" | "preDelete" | "postDelete",
    Record<string, PhasedHook<LifecycleHookFn>[]>
  >;
  configKeys: Record<string, ConfigKeyDefinition>;
  configSeeds: ConfigSeedDef[];
  jobs: Record<string, JobDefinition>;
  events: Record<string, { name: string; schema: ZodType; version: number }>;
  eventMigrations: Record<string, EventMigrationDef[]>;
  configReads: string[];
  entityPostSave: Record<string, PhasedHook<PostSaveHookFn>[]>;
  entityPreDelete: Record<string, PhasedHook<PreDeleteHookFn>[]>;
  entityPostDelete: Record<string, PhasedHook<PostDeleteHookFn>[]>;
  entityPostQuery: Record<string, OwnedFn<PostQueryHookFn>[]>;
  searchPayloadExtensions: Record<string, OwnedFn<SearchPayloadContributorFn>[]>;
  notifications: Record<string, NotificationDefinition>;
  registrarExtensions: Record<string, RegistrarExtensionDef>;
  extensionUsages: RegistrarExtensionRegistration[];
  extensionSelectors: ExtensionSelectorDef[];
  exposedApis: Set<string>;
  usedApis: Set<string>;
  bootChecks: BootCheckFn[];
  referenceData: ReferenceDataDef[];
  handlerEntityMappings: Record<string, string>;
  metrics: Record<string, FeatureMetricDef>;
  secretKeys: Record<string, SecretKeyDefinition>;
  projections: Record<string, ProjectionDefinition>;
  multiStreamProjections: Record<string, MultiStreamProjectionDefinition>;
  entityProjectionExtensions: Record<string, EntityProjectionExtension[]>;
  storeTables: Record<string, StoreTableEntry>;
  authClaimsHooks: AuthClaimsFn[];
  claimKeys: Record<string, ClaimKeyDefinition>;
  screens: Record<string, ScreenDefinition>;
  navs: Record<string, NavDefinition>;
  workspaces: Record<string, WorkspaceDefinition>;
  httpRoutes: Record<string, HttpRouteDefinition>;
  translations: TranslationKeys;
  isSystemScoped: boolean;
  toggleableDefault: boolean | undefined;
  description: string | undefined;
  uiHints: UiHints | undefined;
  treeActions: Readonly<Record<string, TreeActionDef>> | undefined;
  envSchema: z.ZodObject<z.ZodRawShape> | undefined;
};

export function createInitialFeatureBuilderState(): FeatureBuilderState {
  const lifecycleHooks: Record<string, Record<string, OwnedFn<LifecycleHookFn>[]>> = {};
  for (const t of LIFECYCLE_TYPES) {
    lifecycleHooks[t] = {};
  }
  return {
    requires: [],
    optionalRequires: [],
    requiredProjections: new Set<string>(),
    requiredSteps: new Set<string>(),
    entities: {},
    entityTables: {},
    relations: {},
    writeHandlers: {},
    queryHandlers: {},
    validationHooks: {},
    lifecycleHooks,
    phasedLifecycleHooks: { postSave: {}, preDelete: {}, postDelete: {} },
    configKeys: {},
    configSeeds: [],
    jobs: {},
    events: {},
    eventMigrations: {},
    configReads: [],
    entityPostSave: {},
    entityPreDelete: {},
    entityPostDelete: {},
    entityPostQuery: {},
    searchPayloadExtensions: {},
    notifications: {},
    registrarExtensions: {},
    extensionUsages: [],
    extensionSelectors: [],
    exposedApis: new Set(),
    usedApis: new Set(),
    bootChecks: [],
    referenceData: [],
    handlerEntityMappings: {},
    metrics: {},
    secretKeys: {},
    projections: {},
    multiStreamProjections: {},
    entityProjectionExtensions: {},
    storeTables: {},
    authClaimsHooks: [],
    claimKeys: {},
    screens: {},
    navs: {},
    workspaces: {},
    httpRoutes: {},
    translations: {},
    isSystemScoped: false,
    toggleableDefault: undefined,
    description: undefined,
    uiHints: undefined,
    treeActions: undefined,
    envSchema: undefined,
  };
}
