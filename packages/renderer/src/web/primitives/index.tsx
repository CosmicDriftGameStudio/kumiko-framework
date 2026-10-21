/// <reference path="../qrcode-browser.d.ts" />
// Default shadcn + Tailwind primitives for the web renderer. They implement the
// primitives contract from `@cosmicdrift/kumiko-renderer`; colors come from
// Tailwind classes that reference the shadcn CSS variables (no useTokens() calls).
//
// One Tailwind class composition per primitive, variants via
// `class-variance-authority`, Radix UI underneath interactive elements.

import { applyFormatSpec } from "../../headless/index.ts";
import type { CorePrimitives } from "../../index.ts";
import { DefaultDialog } from "./dialog.tsx";
import { DefaultDrawer } from "./drawer.tsx";
import { EmbeddedListInput } from "./embedded-list-input.tsx";
import { FileValueList } from "./file-value-list.tsx";
import { DefaultJsonView } from "./json-view.tsx";
import { DefaultLightbox } from "./lightbox.tsx";
import { DefaultMetric, DefaultMetricBand } from "./metric.tsx";
import { DefaultModal } from "./modal.tsx";
import { DefaultPageHeader } from "./page-header.tsx";
import { PromoPanel } from "./promo-panel.tsx";
import { CopyButton, ShareButton } from "./share-actions.tsx";
import { DefaultStatusBadge } from "./status-badge.tsx";
import { StickyActionBar } from "./sticky-action-bar.tsx";
import { DefaultTabs } from "./tabs.tsx";
import "../react-css-custom-properties.ts";
import { ConfigCascadeView as DefaultConfigCascadeView } from "../components/config-cascade.tsx";
import { ConfigSourceBadge as DefaultConfigSourceBadge } from "../components/config-source-badge.tsx";
import { DefaultBanner } from "./banner.tsx";
import { DefaultButton } from "./button.tsx";
import { DefaultCard } from "./card.tsx";
import { DefaultDataTable } from "./data-table.tsx";
import { DefaultForm } from "./default-form.tsx";
import { DefaultField } from "./field.tsx";
import { DefaultInput } from "./input.tsx";
import {
  DefaultFillContainer,
  DefaultGrid,
  DefaultGridCell,
  DefaultHeading,
  DefaultLink,
  DefaultProgress,
  DefaultSection,
  DefaultStepBar,
  DefaultText,
  DefaultWizardStepGroup,
} from "./layout-elements.tsx";
import { ActionOverflowMenu } from "./row-actions.tsx";
import { DefaultSecretReveal } from "./secret-reveal.tsx";

export { DefaultCard } from "./card.tsx";
export { BareFormProvider, EmbeddedFormProvider, ScreenWidthProvider } from "./contexts.tsx";
export { defaultCellRender, isComponentRendererRef } from "./data-table-cell.tsx";
export type { FormScreenShellWidth } from "./form.tsx";
export { FormScreenShell } from "./form.tsx";
export { END_LABEL_MIN_ROWS } from "./pager.tsx";

// applyFormatSpec re-exported from headless (platform-agnostic).
export { applyFormatSpec };

export const defaultPrimitives: CorePrimitives = {
  Button: DefaultButton,
  Banner: DefaultBanner,
  Field: DefaultField,
  Input: DefaultInput,
  DataTable: DefaultDataTable,
  EmbeddedListInput,
  Form: DefaultForm,
  Section: DefaultSection,
  Card: DefaultCard,
  Grid: DefaultGrid,
  GridCell: DefaultGridCell,
  Text: DefaultText,
  Heading: DefaultHeading,
  Dialog: DefaultDialog,
  Modal: DefaultModal,
  Drawer: DefaultDrawer,
  Lightbox: DefaultLightbox,
  ConfigSourceBadge: DefaultConfigSourceBadge,
  ConfigCascadeView: DefaultConfigCascadeView,
  Link: DefaultLink,
  Progress: DefaultProgress,
  StepBar: DefaultStepBar,
  WizardStepGroup: DefaultWizardStepGroup,
  Tabs: DefaultTabs,
  StatusBadge: DefaultStatusBadge,
  Metric: DefaultMetric,
  MetricBand: DefaultMetricBand,
  PageHeader: DefaultPageHeader,
  JsonView: DefaultJsonView,
  FileValueList,
  FillContainer: DefaultFillContainer,
  ActionOverflowMenu,
  SecretReveal: DefaultSecretReveal,
  StickyActionBar,
  CopyButton,
  ShareButton,
  PromoPanel,
};
