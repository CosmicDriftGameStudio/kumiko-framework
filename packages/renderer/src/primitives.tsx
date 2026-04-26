// Primitives-Contract. Plattform-neutral — die Types beschreiben die
// semantische Oberfläche, die konkrete Implementation (HTML, React
// Native) kommt aus `@kumiko/renderer-web` oder `@kumiko/renderer-native`.
//
// Die Renderer (RenderEdit, RenderList, RenderField, KumikoScreen)
// konsumieren nur diesen Context. Es gibt KEIN Default-Registry hier
// — jede App muss eine vollständige Registry stellen; die Plattform-
// Packages liefern defaultPrimitives mit, die via createKumikoApp
// durchgereicht werden.
//
// Core-Primitives (Kumikos eigene Components konsumieren sie):
//
//   Button    — submit/button, disabled, onClick, variant
//   Banner    — role=alert Box für Fehler/Info, optional Actions
//   Field     — label + issues um ein Input-Control
//   Input     — discriminated union über text/number/boolean/date
//   DataTable — Spalten + Zeilen + onRowClick, Empty-State intern
//   Form      — submit-Wrapper (Web: <form>, Native: View + onSubmit)
//   Section   — titled Gruppe von Feldern (Web: <fieldset>+<legend>)
//   Grid      — columns-basiertes Layout innerhalb einer Section
//   Text      — semantische Text-Variante (body/small/code/required-mark)
//
// App-Primitives (der App-Dev füttert eigene):
//
// Das `AppPrimitives`-Interface ist leer — Devs erweitern es via
// Module-Augmentation mit ihren eigenen Components. Die wandern
// automatisch in `PrimitivesRegistry` und `usePrimitives()` liefert
// sie typed aus. Kumikos Components nutzen sie NICHT (und kennen sie
// nicht), aber der App-Code hat ein einheitliches Primitive-Vokabular
// über Core + Custom.

import type { FieldIssue, ListColumnViewModel, ListRowViewModel } from "@kumiko/headless";
import {
  type ComponentType,
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
} from "react";

// ---- Prop-Types (die Primitive-Contract-Oberfläche) ----

/** Standard-Button. `loading` zeigt einen Spinner statt der Children
 *  und sollte mit `disabled` kombiniert werden, wenn die Action wirklich
 *  blockiert bis das Loading durch ist (z.B. async submit). Native-
 *  Impls können den Spinner als Activity-Indicator rendern. */
export type ButtonProps = {
  readonly type?: "button" | "submit";
  readonly onClick?: () => void | Promise<void>;
  readonly disabled?: boolean;
  /** Spinner statt Children rendern. Caller sollte `disabled` mit-
   *  setzen wenn die Action blockiert bis das Loading abgeschlossen
   *  ist (verhindert Double-Submit). */
  readonly loading?: boolean;
  /** Semantische Klasse — default="primary". Custom-Impls entscheiden
   *  was daraus visuell wird; die Renderer verwenden "primary" für
   *  Save, "danger" für Delete, "secondary" für Confirm-State. */
  readonly variant?: "primary" | "secondary" | "danger";
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Banner für inline-Message ODER Page-State (z.B. "Loading…",
 *  "Screen not found"). `padded` setzt einen Außenabstand damit der
 *  Banner nicht edge-to-edge an den Main-Border klebt — relevant
 *  seit `<main>` kein eigenes Padding mehr hat. */
export type BannerProps = {
  /** "error" für Alerts (Konflikt, Netzfehler), "info" für neutrale
   *  Platzhalter (Not-Found, Loading), "loading" für Lade-States. */
  readonly variant?: "error" | "info" | "loading";
  readonly children: ReactNode;
  /** Optional — weitere Knöpfe/Elemente rechts vom Text (z.B. "Neu
   *  laden"). Inline, nicht als eigener Block. */
  readonly actions?: ReactNode;
  /** Setzt einen Außenabstand um den Banner — für Page-States wo der
   *  Banner alleine im Main rendert (KumikoScreen "not-found",
   *  "loading", etc.). Web fügt p-6 als Margin um den Banner. */
  readonly padded?: boolean;
  readonly testId?: string;
};

export type FieldProps = {
  readonly id: string;
  readonly label: string;
  readonly required?: boolean;
  readonly issues?: readonly FieldIssue[];
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Discriminated union — jede Input-Sorte hat ihre eigene value/onChange
 *  Signatur. Custom-Impls dispatchen intern, rendern anders (Toggle
 *  statt Checkbox), oder nur einzelne kinds unterschiedlich. */
export type InputProps =
  | {
      readonly kind: "text";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** Hint-Text wenn das Feld leer ist. Used für Search-Inputs in
       *  Toolbars ("Suchen…") wo kein Label sinnvoll ist. */
      readonly placeholder?: string;
    }
  | {
      readonly kind: "number";
      readonly id: string;
      readonly name: string;
      readonly value: number | "";
      readonly onChange: (v: number | undefined) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "boolean";
      readonly id: string;
      readonly name: string;
      readonly value: boolean;
      readonly onChange: (v: boolean) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "date";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string | undefined) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "select";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      /** Erlaubte Werte. Leeres Array → Dropdown ohne Optionen, ein
       *  required Field ist dann nicht erfüllbar (Author-Hinweis, nicht
       *  Endnutzer). */
      readonly options: readonly string[];
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "textarea";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      /** Anzahl sichtbarer Zeilen. Default 4 in der Default-Primitive
       *  — hinreichend für Notes, vertikal-scrollbar drüber. */
      readonly rows?: number;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    };

export type DataTableProps = {
  readonly columns: readonly ListColumnViewModel[];
  readonly rows: readonly ListRowViewModel[];
  readonly onRowClick?: (row: ListRowViewModel) => void;
  /** Custom Empty-State-Inhalt (z. B. Icon + Heading + CTA-Button).
   *  Default-Renderer rahmt ihn in einer dashed-border Box. */
  readonly emptyState?: ReactNode;
  /** Optionaler Titel-Slot ganz links der Toolbar — Screen-Titel
   *  ("Items", "Bestellungen"). Web rendert als font-medium Heading. */
  readonly toolbarTitle?: ReactNode;
  /** Toolbar-Slot mittig (typisch Search-Input). Renderer entscheidet
   *  das Layout — Web spreizt das Element als flex-1 mit max-Breite,
   *  Native könnte es als Header-Suchleiste rendern. */
  readonly toolbarStart?: ReactNode;
  /** Toolbar-Slot rechts (typisch + Neu Button, Filter, View-Switch).
   *  Web zieht den Cluster mit ml-auto an die rechte Kante. */
  readonly toolbarEnd?: ReactNode;
  readonly testId?: string;
};

/** Submit-Wrapper. Web: `<form onSubmit>`, Native: View das einen
 *  onSubmit-Callback via Button-Press triggert. `onSubmit` bekommt
 *  eine abstrakte Signatur (keine FormEvent) damit Native-Impls das
 *  sinnvoll füllen können.
 *
 *  `title`: linker Slot der sticky-top Bar — typisch der Screen-Titel
 *  ("Neuer Eintrag", "Bestellung bearbeiten"). Wenn gesetzt, rendert
 *  die Bar mit `justify-between` (Title links, Actions rechts).
 *  `actions`: optionaler Slot für die primären Form-Aktionen (Save,
 *  Cancel). Web rendert die Bar sticky-top, damit der Save-Button
 *  bei langen Forms beim Scrollen erreichbar bleibt. Native-Impls
 *  dürfen denselben Slot z. B. als Bottom-Bar rendern. */
export type FormProps = {
  readonly onSubmit: (e?: FormEvent) => void;
  readonly children: ReactNode;
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly testId?: string;
};

/** Titled Gruppe von Feldern. Web: `<fieldset>` + `<legend>`, Native:
 *  View mit Header-Text. Native-Impls können den Title als Accordion
 *  oder Collapsible rendern. */
export type SectionProps = {
  readonly title: string;
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Columns-basiertes Layout. Web: CSS grid, Native: Flex-Wrap mit
 *  Width-%, oder react-native-grid. Jedes direkte Child kann eine
 *  `GridCell`-Wrapping bekommen für span-Kontrolle. */
export type GridProps = {
  readonly columns: number;
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Span-Wrapper für ein Kind innerhalb eines Grid. Web: `style={{gridColumn: span N}}`,
 *  Native: eigenes Width-Rechnen. */
export type GridCellProps = {
  readonly span?: number;
  readonly children: ReactNode;
};

/** Semantischer Text. Variants bilden Standard-Typografie-Rollen ab —
 *  `body` ist Default, `small` für sekundäre Labels, `code` für inline
 *  monospace (entityId, screen-id), `required-mark` für das Sternchen
 *  hinter Labels. Custom-Impls mappen auf ihren TypeScale. */
export type TextProps = {
  readonly variant?: "body" | "small" | "code" | "required-mark";
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Heading mit zwei Rollen — `page` als Page-Titel (Web: h1), `section`
 *  als Sub-Header über einer Group (Web: h2 mit uppercase + muted).
 *  Native-Impls mappen auf `<Text>` mit entsprechendem fontWeight/Size. */
export type HeadingProps = {
  readonly variant?: "page" | "section";
  readonly children: ReactNode;
  readonly testId?: string;
};

/** Modal-Dialog für Bestätigungen oder kompakte Sub-Forms. Web rendert
 *  Radix-Dialog (Focus-Trap, Esc-Schließen, Overlay-Click); Native
 *  würde ein Native-Modal nutzen. Apps öffnen den Dialog über einen
 *  External-State (`open` + `onOpenChange`); Confirm-Action läuft
 *  durch `onConfirm`, Cancel klappt zu via `onOpenChange(false)`.
 *
 *  Variant `danger` markiert destruktive Bestätigungen visuell
 *  (rote Confirm-Button-Klasse), `default` für neutrale Dialoge. */
export type DialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  /** Optional Beschreibung — typisch ein Satz der die Konsequenz
   *  erklärt ("Diese Aktion lässt sich nicht rückgängig machen."). */
  readonly description?: string;
  /** Confirm-Button-Label. Default kommt aus i18n
   *  (`kumiko.dialog.confirm`). */
  readonly confirmLabel?: string;
  /** Cancel-Button-Label. Default `kumiko.dialog.cancel`. */
  readonly cancelLabel?: string;
  /** `default` = Confirm primary, `danger` = Confirm danger. */
  readonly variant?: "default" | "danger";
  /** Wird gefeuert wenn der User Confirm drückt. Async-Funktion ist
   *  ok — Dialog setzt automatisch loading-State, ruft danach
   *  onOpenChange(false). */
  readonly onConfirm: () => void | Promise<void>;
  /** Optional zusätzlicher Inhalt zwischen description und Buttons
   *  (z.B. ein Input wenn der Dialog auch Eingaben sammelt). */
  readonly children?: ReactNode;
  readonly testId?: string;
};

// ---- Core-Registry (Kumiko-eigene Primitives) ----

export type CorePrimitives = {
  readonly Button: ComponentType<ButtonProps>;
  readonly Banner: ComponentType<BannerProps>;
  readonly Field: ComponentType<FieldProps>;
  readonly Input: ComponentType<InputProps>;
  readonly DataTable: ComponentType<DataTableProps>;
  readonly Form: ComponentType<FormProps>;
  readonly Section: ComponentType<SectionProps>;
  readonly Grid: ComponentType<GridProps>;
  readonly GridCell: ComponentType<GridCellProps>;
  readonly Text: ComponentType<TextProps>;
  readonly Heading: ComponentType<HeadingProps>;
  readonly Dialog: ComponentType<DialogProps>;
};

/** Offene Extension-Zone für App-eigene Primitives. Devs erweitern
 *  dieses Interface via TypeScript Module-Augmentation:
 *
 *    declare module "@kumiko/renderer" {
 *      interface AppPrimitives {
 *        Chip: ComponentType<ChipProps>;
 *        Accordion: ComponentType<AccordionProps>;
 *      }
 *    }
 *
 *  Nach der Augmentation tauchen die Keys in `PrimitivesRegistry`,
 *  `createKumikoApp({ primitives: { Chip, Accordion } })`, und
 *  `usePrimitives().Chip` auf — TypeScript-gestützt. Kumikos eigene
 *  Components nutzen ausschließlich `CorePrimitives`; App-Primitives
 *  sind ausschließlich für Dev-Code (Custom-Screens, Shell, eigene
 *  Components). */
// biome-ignore lint/suspicious/noEmptyInterface: extension point for module augmentation
export interface AppPrimitives {}

export type PrimitivesRegistry = CorePrimitives & AppPrimitives;

// ---- Context + Provider + Hook ----

const PrimitivesContext = createContext<PrimitivesRegistry | undefined>(undefined);

export type PrimitivesProviderProps = {
  readonly children: ReactNode;
  readonly value: PrimitivesRegistry;
};

export function PrimitivesProvider({ children, value }: PrimitivesProviderProps): ReactNode {
  return <PrimitivesContext.Provider value={value}>{children}</PrimitivesContext.Provider>;
}

export function usePrimitives(): PrimitivesRegistry {
  const registry = useContext(PrimitivesContext);
  if (registry === undefined) {
    throw new Error(
      "usePrimitives: no <PrimitivesProvider> mounted. Wrap your app in one (createKumikoApp does this for you with defaultPrimitives from @kumiko/renderer-web).",
    );
  }
  return registry;
}
