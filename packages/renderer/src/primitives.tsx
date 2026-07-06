// Primitives-Contract. Plattform-neutral — die Types beschreiben die
// semantische Oberfläche, die konkrete Implementation (HTML, React
// Native) kommt aus `@cosmicdrift/kumiko-renderer-web` oder `@cosmicdrift/kumiko-renderer-native`.
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

import type {
  ConfigCascade,
  ConfigScope,
  ConfigValueSource,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  FieldIssue,
  ListColumnViewModel,
  ListRowViewModel,
  RuntimeRenderer,
} from "@cosmicdrift/kumiko-headless";
import {
  type ComponentType,
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
} from "react";

export type { RuntimeRenderer };

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
  readonly labelAppendix?: ReactNode;
  readonly fieldAppendix?: ReactNode;
  readonly children: ReactNode;
  /** Label-Layout. `stacked` (Default): Label über dem Control. `inline`:
   *  Control + Label nebeneinander (Box links, Label rechts) — für
   *  Checkbox/Switch-Felder (boolean), wie das shadcn-Muster. */
  readonly layout?: "stacked" | "inline";
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
      /** Browser-Autofill / Native-Keyboard-Hint. Web setzt das auf
       *  `<input autocomplete=...>`, Native auf `textContentType`. */
      readonly autoComplete?: string;
    }
  | {
      readonly kind: "email";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      readonly placeholder?: string;
      /** Default "email". Apps die "username" wollen (Login-Form mit
       *  Username-or-Email) reichen das durch. */
      readonly autoComplete?: string;
    }
  | {
      readonly kind: "password";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** "current-password" für Login, "new-password" für Reset/Signup —
       *  Browser-Password-Manager nutzen das für die Speicherentscheidung.
       *  Native: textContentType="password" / "newPassword". */
      readonly autoComplete?: "current-password" | "new-password";
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
      readonly kind: "file" | "image";
      readonly id: string;
      readonly name: string;
      /** FileRef-UUID (gespeicherte Datei) oder null (kein Upload). */
      readonly value: string | null;
      readonly onChange: (fileId: string | null) => void;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      /** Erlaubte Extensions/MIME (z.B. ["jpg","png"]) → `accept`-Attribut. */
      readonly accept?: readonly string[];
      readonly maxSize?: string;
      /** Für den Upload-POST `/api/files` — der Endpoint prüft maxSize/accept
       *  gegen die Field-Def von (entityType, fieldName). */
      readonly entityType?: string;
      readonly fieldName?: string;
    }
  | {
      readonly kind: "date";
      readonly id: string;
      readonly name: string;
      readonly value: string;
      readonly onChange: (v: string | undefined) => void;
      /** Locale für Anzeige UND Eingabe-Parsing. Default = Browser-Locale
       *  via navigator.language. Apps mit eigenem LocaleResolver können
       *  ihren current locale durchreichen. */
      readonly locale?: string;
      /** Datumsgrenzen als ISO `yyyy-mm-dd` — begrenzen Picker (Jahres-
       *  Dropdown-Range + ausgegraute Tage). */
      readonly min?: string;
      readonly max?: string;
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
       *  Endnutzer). String-Form für statische Listen (Wert == Label),
       *  {value,label}-Form für DB-getragene Refs (Tier 2.7e-3). */
      readonly options:
        | readonly string[]
        | readonly { readonly value: string; readonly label: string }[];
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | ({
      // Tier 2.1c: Combobox / Searchable-Select. Single-Mode (multiple
      // false oder weggelassen): value ist string, onChange string.
      // Multi-Mode (multiple: true): value ist string[], onChange
      // string[]. Reference-Felder (Tier 2.7e-3+) nutzen das hier ohne
      // explizit Combobox zu setzen — der Renderer wählt Combobox
      // automatisch für reference-Field-Types.
      // Discriminated-Union per `multiple`: Single-Mode hat string-
      // value/onChange, Multi-Mode hat readonly string[] — Caller
      // muss den Mode beim Build wählen, der Compiler zwingt die
      // richtige Signatur.
      readonly kind: "combobox";
      readonly id: string;
      readonly name: string;
      readonly options: readonly { readonly value: string; readonly label: string }[];
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
      readonly placeholder?: string;
      readonly searchPlaceholder?: string;
      readonly emptyText?: string;
      /** Tier 2.7e Remote-Search: gesetzt = Combobox läuft im Remote-
       *  Mode (cmdk-Local-Filter aus, Search-Input ruft onSearchChange
       *  debounced an den Caller). */
      readonly onSearchChange?: (q: string) => void;
      readonly loading?: boolean;
    } & (
      | {
          readonly multiple?: false;
          readonly value: string;
          readonly onChange: (v: string) => void;
        }
      | {
          readonly multiple: true;
          readonly value: readonly string[];
          readonly onChange: (v: readonly string[]) => void;
        }
    ))
  | {
      readonly kind: "money";
      readonly id: string;
      readonly name: string;
      /** Internal-Format: Cents/Minor-Units als Integer (z.B. 1299 für
       *  12,99 EUR). Renderer übersetzt fürs UI in Major-Units mit
       *  Locale-formatierten Dezimalstellen. Empty-State = `""`. */
      readonly value: number | "";
      readonly onChange: (v: number | undefined) => void;
      /** ISO-4217 Currency-Code, z.B. "EUR" / "USD" / "CHF". Default
       *  "EUR". Renderer zeigt das Symbol als Suffix und formatiert die
       *  Decimal-Stellen entsprechend (EUR/USD/CHF haben 2, JPY hat 0). */
      readonly currency?: string;
      /** Locale für Zahlen-Formatierung. Default "de-DE" (Komma als
       *  Dezimaltrenner). Apps mit eigenem LocaleResolver können ihren
       *  current locale durchreichen. */
      readonly locale?: string;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "timestamp";
      readonly id: string;
      readonly name: string;
      /** ISO-8601 Datetime-String. UTC-Instant mit `Z`
       *  ("2026-04-25T13:45:00Z") oder Wall-Clock ohne Offset
       *  ("2026-04-25T13:45", nur bei wallClock). Empty-State = `""`.
       *  Web rendert getrennte Datums- (tippbar + Kalender) und
       *  Uhrzeit-Eingabe und konvertiert. */
      readonly value: string;
      readonly onChange: (v: string | undefined) => void;
      /** true = locatedTimestamp (Wall-Clock ohne Offset, Server
       *  validiert z.iso.datetime({local:true})). false/undefined =
       *  UTC-Instant, onChange MUSS mit `Z`-Suffix emittieren. */
      readonly wallClock?: boolean;
      /** Locale für Anzeige UND Eingabe-Parsing des Datums-Teils.
       *  Default = Browser-Locale. */
      readonly locale?: string;
      /** Datumsgrenzen als ISO-Datetime — begrenzen den Kalender auf
       *  Tages-Granularität. */
      readonly min?: string;
      readonly max?: string;
      readonly disabled?: boolean;
      readonly required?: boolean;
      readonly hasError?: boolean;
    }
  | {
      readonly kind: "locatedTimestamp";
      readonly id: string;
      readonly name: string;
      /** Located-Timestamp-Wert: Wall-Clock `at` (ohne Offset) + IANA-`tz`.
       *  `utc` ist beim Read da (server-berechnet) und wird beim Write
       *  ignoriert. Empty-State = `""`. onChange emittiert `{ at, tz }`. */
      readonly value: { readonly at: string; readonly tz: string; readonly utc?: string } | "";
      readonly onChange: (v: { readonly at: string; readonly tz: string } | undefined) => void;
      /** Locale für den Datums-Teil. Default = Browser-Locale. */
      readonly locale?: string;
      /** Datumsgrenzen als ISO-Datetime — begrenzen den Kalender. */
      readonly min?: string;
      readonly max?: string;
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

// Sort-Wire-Format. `null`-State unterscheidet "User hat noch nichts
// gesortiert" vom "ich sortiere nach X" — wichtig für 3-State-Toggle
// (asc → desc → null → asc …). Renderer kennt den aktuellen sort und
// callt onSortChange wenn der User auf einen sortable-Header klickt.
export type DataTableSortDir = "asc" | "desc";
export type DataTableSort = {
  readonly field: string;
  readonly dir: DataTableSortDir;
};

// Render-Modus der Row-Action-Spalte (siehe DataTableProps.rowActionMode).
export type DataTableRowActionMode = "adaptive" | "inline";

// Resolved-Form einer Row-Action (KumikoScreen baut das aus
// EntityListScreenDefinition.rowActions): Labels schon translated,
// handler-QN aufgelöst zu einer onTrigger-Function die den dispatcher
// kennt. DataTable rendert das ohne weiteres i18n/dispatcher-Wissen.
export type DataTableRowAction = {
  /** Stable id für aria-labels und data-testids. */
  readonly id: string;
  /** Translated Label. */
  readonly label: string;
  /** Visual-Style — danger triggert in der Default-Primitive eine rote
   *  Variante UND erzwingt einen Confirm-Dialog wenn keiner gesetzt ist. */
  readonly style?: "primary" | "secondary" | "danger";
  /** Translated Confirm-Prompt (Description im Dialog) — wenn gesetzt,
   *  öffnet ein Modal vor der Ausführung. Bei style=danger ohne expliziten
   *  confirm sollte der Renderer einen generischen Default zeigen. */
  readonly confirm?: string;
  /** Translated Confirm-Button-Label im Dialog. Default = `label`
   *  (Action-Label wird wiederverwendet). */
  readonly confirmLabel?: string;
  /** Wird mit der ListRowViewModel der geklickten Row aufgerufen. Async
   *  erlaubt — der Renderer kann während der Promise-Resolution einen
   *  Loading-State auf dem Button zeigen. */
  readonly onTrigger: (row: ListRowViewModel) => Promise<void> | void;
  /** Conditional Visibility pro Row (z.B. "Start" nur wenn status==="scheduled"). */
  readonly isVisible?: (row: ListRowViewModel) => boolean;
};

// Ein Faceted-Filter-Slot in der Toolbar: ein Outline-Dropdown-Button
// (wie shadcns "Columns"-Toggle) mit Multi-Select-Checkboxen. KumikoScreen
// baut das aus den filterable select/boolean-Feldern des Entity.
export type DataTableFacet = {
  /** Entity-Feldname (= URL-State-Key + payload.filters[].field). */
  readonly field: string;
  /** Translated Button-Label ("Status", "Active"). */
  readonly label: string;
  /** Auswählbare Werte mit Anzeige-Label. value = roher Filterwert
   *  (select-option / "true"|"false"), als String transportiert. */
  readonly options: readonly { readonly value: string; readonly label: string }[];
};

export type DataTableProps = {
  readonly columns: readonly ListColumnViewModel[];
  readonly rows: readonly ListRowViewModel[];
  readonly onRowClick?: (row: ListRowViewModel) => void;
  /** Aktuelle Sortierung (oder null = unsorted). Wenn columns ein
   *  `sortable: true`-Feld haben und onSortChange gesetzt ist, rendert
   *  der Renderer Click-Header mit Asc/Desc-Indikator. Ohne onSortChange
   *  bleibt die Header-Click-Mechanik aus, columns.sortable ist dann nur
   *  semantischer Hinweis. */
  readonly sort?: DataTableSort | null;
  /** Wird gerufen mit dem nächsten Sort-State nach einem Header-Klick.
   *  3-State-Toggle (Convention): asc → desc → null. Caller setzt damit
   *  seinen URL-State / Query-Param und triggert ein refetch. */
  readonly onSortChange?: (next: DataTableSort | null) => void;
  /** Pro-Row-Aktionen — eine Spalte am rechten Rand mit Inline-Buttons
   *  (≤2 Aktionen) oder Kebab-Dropdown (>2). Caller liefert Resolved-
   *  Form (Labels + onTrigger schon verdrahtet); DataTable kümmert
   *  sich nur um Render + Confirm-Dialog. */
  readonly rowActions?: readonly DataTableRowAction[];
  /** Wie die Row-Action-Spalte rendert:
   *  - `"adaptive"` (Default): ≤2 sichtbare Actions inline (rechtsbündig),
   *    >2 als Kebab-Dropdown. Passt die Optik automatisch an die Anzahl an.
   *  - `"inline"`: IMMER Inline-Buttons, linksbündig — auch bei >2 (kein
   *    Kebab). So stehen die Aktionen über alle Rows an derselben x-Position
   *    (kein Wandern durch unterschiedlich breite Labels) und alle Listen
   *    einer App sehen gleich aus. */
  readonly rowActionMode?: DataTableRowActionMode;
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
  /** Faceted-Filter-Dropdowns (select/boolean-Felder) — der Renderer
   *  setzt sie neben das Search-Input. Leer/undefined → keine Filter. */
  readonly filterFacets?: readonly DataTableFacet[];
  /** Aktuell ausgewählte Werte je Facet-Feld (vom URL-State). */
  readonly filterValues?: Readonly<Record<string, readonly string[]>>;
  /** Toggle eines Facet-Werts → Caller schreibt URL-State + refetch. */
  readonly onFilterChange?: (field: string, values: readonly string[]) => void;
  /** Reset-Button: löscht alle aktiven Facets. Renderer zeigt ihn nur
   *  wenn mindestens ein Facet aktiv ist. */
  readonly onFilterReset?: () => void;
  /** Pagination-State + Callback. Wenn gesetzt, rendert der Renderer
   *  einen Pager unter der Tabelle (Web: Footer-Bar mit ← 1 ... N →).
   *  total/limit/page sind 1-basiert für die UI; Server-Translation
   *  zu offset = (page-1)*limit liegt beim Caller. Wenn page > total/limit
   *  würde, soll der Caller das vorab clampen. */
  readonly pager?: {
    readonly page: number;
    readonly limit: number;
    readonly total: number;
    readonly onPageChange: (next: number) => void;
  };
  /** Infinite-Scroll Callback. Wenn gesetzt, rendert der Renderer einen
   *  Bottom-Sentinel und ruft `onReachEnd` wenn der ins Viewport rückt
   *  (Web: IntersectionObserver). Caller verwaltet accumulation +
   *  cursor + hasMore. `loadingMore=true` zeigt einen Spinner unter
   *  der Tabelle solange die nächste Page lädt. Inkompatibel mit
   *  `pager` — entweder Pager ODER Infinite-Scroll, nicht beides. */
  readonly onReachEnd?: () => void;
  readonly loadingMore?: boolean;
  /** Wenn false und onReachEnd gesetzt, rendert der Renderer einen
   *  "Ende der Liste"-Hinweis statt des Sentinels. Default true. */
  readonly hasMore?: boolean;
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
  /** Optionaler muted Untertitel unter dem Titel (z.B. "Add a new item to
   *  your catalog") — gibt dem Form-Header Kontext statt nur ein Label. */
  readonly subtitle?: ReactNode;
  readonly actions?: ReactNode;
  readonly testId?: string;
};

/** Titled Gruppe von Feldern. Web: `<fieldset>` + `<legend>`, Native:
 *  View mit Header-Text. Native-Impls können den Title als Accordion
 *  oder Collapsible rendern. */
export type SectionProps = {
  /** Optional — ohne Titel rendert die Section nur die Gruppierung
   *  (kein Header). RenderEdit lässt ihn weg, wenn er den Screen-Titel
   *  der Action-Bar 1:1 wiederholen würde. */
  readonly title?: string;
  /** Optionaler muted Untertitel unter dem Titel — gibt der Section
   *  Kontext statt nur ein Label (analog FormProps.subtitle). */
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  /** Optionaler Aktions-Slot am Fuß der Section (z.B. „In Finanzierung
   *  übernehmen"). Web rendert standalone eine abgehobene Footer-Row
   *  (border-t), innerhalb eines Forms eine rechtsbündige Button-Reihe. */
  readonly actions?: ReactNode;
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

/** Image lightbox — full-size preview on click. Web renders Radix overlay;
 *  trigger (thumbnail) and open state live in the app. */
export type LightboxProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly src: string;
  readonly alt: string;
  readonly testId?: string;
};

/** Source-badge for one cascade step (User / Tenant / System / …).
 *  Used inline next to a config value to indicate where it came from.
 *  Requires a LocaleProvider above it (labels run through useTranslation)
 *  — createKumikoApp wires one; standalone consumers must wrap. */
export type ConfigSourceBadgeProps = {
  readonly source: ConfigValueSource;
  /** Scope of the hosting screen. Non-system screens collapse sources
   *  ABOVE their scope (system-row/app-override/computed) into the neutral
   *  default badge — operator internals stay invisible to tenants, same
   *  rule as ConfigCascadeView's toDisplayLevels. */
  readonly screenScope?: ConfigScope;
};

/** Collapsible cascade-view for a config-edit field. Split into two slots
 *  (#429): "trigger" is the collapsed ▶ + source + value line for the label
 *  row; "panel" is the expanded cascade + reset shown below the input. In
 *  split mode the screen owns the `expanded` state (both slots share it);
 *  without `slot` the component renders both with its own state. */
export type ConfigCascadeViewProps = {
  readonly cascade: ConfigCascade;
  readonly screenScope: ConfigScope;
  readonly onReset?: (key: string, scope: ConfigScope) => void;
  readonly qualifiedKey?: string;
  readonly slot?: "trigger" | "panel";
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
};

/** Card-Slots — benannte Inhalts-Regionen, alle optional. Neue Slots später =
 *  rein additiv → Consumer müssen NIE migriert werden. `header` ist der Escape-
 *  Hatch: ein roher Knoten ersetzt den Default-Header (title/subtitle/
 *  headerActions) komplett, wenn die Convenience-Slots nicht reichen. */
export type CardSlots = {
  readonly header?: ReactNode;
  readonly title?: ReactNode;
  readonly subtitle?: ReactNode;
  /** Rechtsbündiger Header-Slot (Range-Umschalter, Filter, Badge …). */
  readonly headerActions?: ReactNode;
  /** Footer-Inhalt, abgehoben (border-t). Default rechtsbündig. */
  readonly footer?: ReactNode;
};

/** Card-Options — Verhalten/Optik, ebenfalls additiv erweiterbar. */
export type CardOptions = {
  /** Body-Padding (px-6 py-6). false = randlos (Tabelle/eigene Tiles). Default true. */
  readonly padded?: boolean;
  /** Eckenradius. Default "xl" (= Entity-Card). */
  readonly radius?: "lg" | "xl";
  /** Footer abgehoben mit border-t + bg-muted/30. Default true. */
  readonly footerBordered?: boolean;
};

/** Generische Card-Chrome (border/bg/radius/shadow + Header/Body/Footer) als
 *  Primitive — eine Quelle für alle Card-Flächen, statt pro App nachgebaut.
 *  Slot- + Options-basiert, damit der Contract stabil bleibt. */
export type CardProps = {
  readonly slots?: CardSlots;
  readonly options?: CardOptions;
  /** Body-Inhalt (Normalfall; Header/Footer kommen über slots). */
  readonly children?: ReactNode;
  readonly className?: string;
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
  readonly Card: ComponentType<CardProps>;
  readonly Grid: ComponentType<GridProps>;
  readonly GridCell: ComponentType<GridCellProps>;
  readonly Text: ComponentType<TextProps>;
  readonly Heading: ComponentType<HeadingProps>;
  readonly Dialog: ComponentType<DialogProps>;
  readonly Lightbox: ComponentType<LightboxProps>;
  readonly ConfigSourceBadge: ComponentType<ConfigSourceBadgeProps>;
  readonly ConfigCascadeView: ComponentType<ConfigCascadeViewProps>;
};

/** Offene Extension-Zone für App-eigene Primitives. Devs erweitern
 *  dieses Interface via TypeScript Module-Augmentation:
 *
 *    declare module "@cosmicdrift/kumiko-renderer" {
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
      "usePrimitives: no <PrimitivesProvider> mounted. Wrap your app in one (createKumikoApp does this for you with defaultPrimitives from @cosmicdrift/kumiko-renderer-web).",
    );
  }
  return registry;
}
