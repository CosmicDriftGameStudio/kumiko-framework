import { createContext, type ReactNode } from "react";
import type { FieldProps, FormWidth } from "../../index.ts";
import "../react-css-custom-properties.ts";

// Boolean optics depend on the surrounding Field layout: layout="inline"
// (checkbox lists like MultiSelectCheckboxes, the BooleanField widget) keeps
// the checkbox, the standard form field (layout="stacked"/default) gets the
// new switch. Pure web-renderer rendering decision, no contract field needed
// — Field hands its resolved layout down to the nested Input via context.
export const FieldLayoutContext = createContext<FieldProps["layout"]>("stacked");

// True inside the sections of a card-less screen form: sections then drop their
// own horizontal padding, the screen form's scroll surface provides it.
export const ScreenFormContext = createContext(false);

export const DrawerBodyContext = createContext(false);

// aria-labelledby into a Field label that doesn't exist leaves a radiogroup
// without any accessible name — fall back to the control's name instead.
export const FieldLabelledContext = createContext(false);

// The Field description is the control's accessible description; the control
// is a descendant (not a prop of Field), so the id travels via context. Always
// provided (undefined without a description) so a nested Field never inherits
// its parent's description id.
export const FieldDescriptionContext = createContext<string | undefined>(undefined);

// ---- Form + Section + Grid + Text ----

// Puts DefaultSection into inner-region mode: the whole form is ONE card,
// sections are divider-separated parts inside it (shadcn pattern like
// Shipping/Invoice/Profile). Standalone (outside a form) a section stays its
// own card.
export const InsideFormContext = createContext(false);

// Embedded forms (e.g. in AuthCard) already get their card surface from the
// container; the self-carding DefaultForm would otherwise produce a
// card-in-card. BareFormProvider switches DefaultForm to a bare <form>
// (stacked fields, no frame of its own/max-width).
export const BareFormContext = createContext(false);

// Dashboard panels with an embedded settings form (`DashboardScreenPanel.chromeless`):
// the form renders in the page grid like a standalone screen form, without the
// card frame, but keeps its own (non-pinned) save bar.
export const EmbeddedFormContext = createContext(false);

export function EmbeddedFormProvider({ children }: { children: ReactNode }): ReactNode {
  return <EmbeddedFormContext.Provider value={true}>{children}</EmbeddedFormContext.Provider>;
}

export function BareFormProvider({ children }: { children: ReactNode }): ReactNode {
  return <BareFormContext.Provider value={true}>{children}</BareFormContext.Provider>;
}

// App-wide default for FormScreenShell's width when a screen doesn't set its
// own `layout.width`. Undefined (no `createKumikoApp({ screenWidth })`) lets each
// shell keep its own default: "4xl" for FormScreenShell, 640px for the
// screen-form column.
export const ScreenWidthContext = createContext<FormWidth | undefined>(undefined);

export function ScreenWidthProvider({
  width,
  children,
}: {
  readonly width: FormWidth | undefined;
  readonly children: ReactNode;
}): ReactNode {
  return <ScreenWidthContext.Provider value={width}>{children}</ScreenWidthContext.Provider>;
}
