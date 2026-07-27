// Form templates from four unrelated domains — shows how SectionCard +
// Grid/GridCell + field widgets compose into dense but responsive forms
// (1-col on mobile, multi-col from sm via Grid columns). No new widgets:
// composition reference for app screens.

import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import {
  BooleanField,
  DateField,
  NumberField,
  RangeField,
  SectionCard,
  SelectField,
  TextareaField,
  TextField,
  useDraft,
} from "@cosmicdrift/kumiko-renderer-web";
import type { ReactNode } from "react";

export function FormExamples(): ReactNode {
  return (
    <div className="flex flex-col gap-6 p-6" data-testid="form-examples-page">
      <CrmContactForm />
      <IndustrieWartungsForm />
      <MedizinAufnahmeForm />
      <ProtokollForm />
    </div>
  );
}

interface CrmDraft {
  readonly vorname: string;
  readonly nachname: string;
  readonly email: string;
  readonly telefon: string;
  readonly firma: string;
  readonly position: string;
  readonly branche: string;
  readonly strasse: string;
  readonly plz: string;
  readonly ort: string;
  readonly land: string;
  readonly notiz: string;
}

const CRM_DEFAULTS: CrmDraft = {
  vorname: "",
  nachname: "",
  email: "",
  telefon: "",
  firma: "",
  position: "",
  branche: "",
  strasse: "",
  plz: "",
  ort: "",
  land: "DE",
  notiz: "",
};

// CRM: create contact/lead — many optional fields, grouped by
// person/company/address instead of one long linear list.
function CrmContactForm(): ReactNode {
  const { field } = useDraft<CrmDraft>(CRM_DEFAULTS);
  const { Grid, GridCell } = usePrimitives();
  return (
    <SectionCard title="CRM · Kontakt anlegen" subtitle="Person, Firma, Adresse">
      <Grid columns={2}>
        <GridCell>
          <TextField label="Vorname" {...field("vorname")} />
        </GridCell>
        <GridCell>
          <TextField label="Nachname" {...field("nachname")} />
        </GridCell>
        <GridCell>
          <TextField label="E-Mail" {...field("email")} autoComplete="email" />
        </GridCell>
        <GridCell>
          <TextField label="Telefon" {...field("telefon")} autoComplete="tel" />
        </GridCell>
      </Grid>
      <Grid columns={2}>
        <GridCell>
          <TextField label="Firma" {...field("firma")} />
        </GridCell>
        <GridCell>
          <TextField label="Position" {...field("position")} />
        </GridCell>
        <GridCell span={2}>
          <SelectField
            label="Branche"
            {...field("branche")}
            options={["Industrie", "Handel", "Dienstleistung", "Gesundheitswesen"]}
          />
        </GridCell>
      </Grid>
      <Grid columns={3}>
        <GridCell span={2}>
          <TextField label="Straße" {...field("strasse")} />
        </GridCell>
        <GridCell>
          <TextField label="PLZ" {...field("plz")} />
        </GridCell>
        <GridCell span={2}>
          <TextField label="Ort" {...field("ort")} />
        </GridCell>
        <GridCell>
          <SelectField
            label="Land"
            {...field("land")}
            options={[
              { value: "DE", label: "Deutschland" },
              { value: "AT", label: "Österreich" },
              { value: "CH", label: "Schweiz" },
            ]}
          />
        </GridCell>
      </Grid>
      <TextareaField label="Notiz" {...field("notiz")} rows={3} />
    </SectionCard>
  );
}

interface IndustrieDraft {
  readonly anlagenId: string;
  readonly standort: string;
  readonly pruefdatum: string;
  readonly temperatur: number | undefined;
  readonly druck: number | undefined;
  readonly vibration: number;
  readonly status: string;
  readonly bestanden: boolean;
  readonly maengel: string;
}

const INDUSTRIE_DEFAULTS: IndustrieDraft = {
  anlagenId: "A-2231",
  standort: "Halle 3",
  pruefdatum: "2026-07-26",
  temperatur: 62,
  druck: 4.1,
  vibration: 2.5,
  status: "ok",
  bestanden: true,
  maengel: "",
};

// Industry: maintenance / asset check — measurements with units in the
// label, often filled on a tablet on site.
function IndustrieWartungsForm(): ReactNode {
  const { draft, field } = useDraft<IndustrieDraft>(INDUSTRIE_DEFAULTS);
  const { Grid, GridCell } = usePrimitives();
  return (
    <SectionCard title="Industrie · Wartungsprotokoll" subtitle="Anlage, Messwerte, Ergebnis">
      <Grid columns={3}>
        <GridCell>
          <TextField label="Anlagen-ID" {...field("anlagenId")} />
        </GridCell>
        <GridCell>
          <SelectField
            label="Standort"
            {...field("standort")}
            options={["Halle 1", "Halle 2", "Halle 3", "Außenlager"]}
          />
        </GridCell>
        <GridCell>
          <DateField label="Prüfdatum" {...field("pruefdatum")} />
        </GridCell>
      </Grid>
      <Grid columns={3}>
        <GridCell>
          <NumberField label="Temperatur (°C)" {...field("temperatur")} />
        </GridCell>
        <GridCell>
          <NumberField label="Druck (bar)" {...field("druck")} />
        </GridCell>
        <GridCell>
          <SelectField
            label="Status"
            {...field("status")}
            options={[
              { value: "ok", label: "In Ordnung" },
              { value: "warn", label: "Beobachten" },
              { value: "kritisch", label: "Kritisch" },
            ]}
          />
        </GridCell>
      </Grid>
      <RangeField
        label={`Vibration: ${draft.vibration} mm/s`}
        {...field("vibration")}
        min={0}
        max={10}
        step={0.1}
      />
      <BooleanField label="Prüfung bestanden" {...field("bestanden")} />
      <TextareaField label="Mängel" {...field("maengel")} rows={3} />
    </SectionCard>
  );
}

interface MedizinDraft {
  readonly patientName: string;
  readonly geburtsdatum: string;
  readonly versicherung: string;
  readonly groesse: number | undefined;
  readonly gewicht: number | undefined;
  readonly blutdruck: string;
  readonly puls: number | undefined;
  readonly allergien: string;
  readonly dauermedikation: boolean;
  readonly einwilligung: boolean;
}

const MEDIZIN_DEFAULTS: MedizinDraft = {
  patientName: "",
  geburtsdatum: "",
  versicherung: "gesetzlich",
  groesse: undefined,
  gewicht: undefined,
  blutdruck: "",
  puls: undefined,
  allergien: "",
  dauermedikation: false,
  einwilligung: false,
};

// Medicine: patient intake — sensitive data clearly separated, many
// required fields, vitals as a narrow four-column row.
function MedizinAufnahmeForm(): ReactNode {
  const { field } = useDraft<MedizinDraft>(MEDIZIN_DEFAULTS);
  const { Grid, GridCell } = usePrimitives();
  return (
    <SectionCard title="Medizin · Patientenaufnahme" subtitle="Person, Vitalwerte, Anamnese">
      <Grid columns={3}>
        <GridCell>
          <TextField label="Name" {...field("patientName")} required />
        </GridCell>
        <GridCell>
          <DateField label="Geburtsdatum" {...field("geburtsdatum")} required />
        </GridCell>
        <GridCell>
          <SelectField
            label="Versicherung"
            {...field("versicherung")}
            options={[
              { value: "gesetzlich", label: "Gesetzlich" },
              { value: "privat", label: "Privat" },
              { value: "selbstzahler", label: "Selbstzahler" },
            ]}
          />
        </GridCell>
      </Grid>
      <Grid columns={4}>
        <GridCell>
          <NumberField label="Größe (cm)" {...field("groesse")} />
        </GridCell>
        <GridCell>
          <NumberField label="Gewicht (kg)" {...field("gewicht")} />
        </GridCell>
        <GridCell>
          <TextField label="Blutdruck" {...field("blutdruck")} placeholder="120/80" />
        </GridCell>
        <GridCell>
          <NumberField label="Puls (bpm)" {...field("puls")} />
        </GridCell>
      </Grid>
      <TextareaField label="Allergien" {...field("allergien")} rows={2} />
      <Grid columns={2}>
        <GridCell>
          <BooleanField label="Dauermedikation vorhanden" {...field("dauermedikation")} />
        </GridCell>
        <GridCell>
          <BooleanField label="Einwilligung erteilt" {...field("einwilligung")} />
        </GridCell>
      </Grid>
    </SectionCard>
  );
}

interface ProtokollDraft {
  readonly titel: string;
  readonly datum: string;
  readonly kategorie: string;
  readonly teilnehmer: string;
  readonly beschreibung: string;
  readonly nachfassenNoetig: boolean;
  readonly eskaliert: boolean;
  readonly abgeschlossen: boolean;
}

const PROTOKOLL_DEFAULTS: ProtokollDraft = {
  titel: "",
  datum: "2026-07-26",
  kategorie: "meeting",
  teilnehmer: "",
  beschreibung: "",
  nachfassenNoetig: false,
  eskaliert: false,
  abgeschlossen: false,
};

// Protocol: meeting / incident log — free-text heavy, checklist as a
// compact boolean row instead of a custom multi-select.
function ProtokollForm(): ReactNode {
  const { field } = useDraft<ProtokollDraft>(PROTOKOLL_DEFAULTS);
  const { Grid, GridCell } = usePrimitives();
  return (
    <SectionCard title="Protokoll · Meeting/Incident-Log" subtitle="Meta, Verlauf, Maßnahmen">
      <Grid columns={3}>
        <GridCell span={2}>
          <TextField label="Titel" {...field("titel")} />
        </GridCell>
        <GridCell>
          <DateField label="Datum" {...field("datum")} />
        </GridCell>
      </Grid>
      <Grid columns={3}>
        <GridCell span={2}>
          <TextField label="Teilnehmer" {...field("teilnehmer")} placeholder="Kommagetrennt" />
        </GridCell>
        <GridCell>
          <SelectField
            label="Kategorie"
            {...field("kategorie")}
            options={[
              { value: "meeting", label: "Meeting" },
              { value: "incident", label: "Incident" },
              { value: "review", label: "Review" },
            ]}
          />
        </GridCell>
      </Grid>
      <TextareaField label="Beschreibung" {...field("beschreibung")} rows={6} />
      <Grid columns={3}>
        <GridCell>
          <BooleanField label="Nachfassen nötig" {...field("nachfassenNoetig")} />
        </GridCell>
        <GridCell>
          <BooleanField label="Eskaliert" {...field("eskaliert")} />
        </GridCell>
        <GridCell>
          <BooleanField label="Abgeschlossen" {...field("abgeschlossen")} />
        </GridCell>
      </Grid>
    </SectionCard>
  );
}
