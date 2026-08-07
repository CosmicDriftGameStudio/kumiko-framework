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
      <MaintenanceLogForm />
      <PatientIntakeForm />
      <IncidentLogForm />
    </div>
  );
}

interface CrmDraft {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly company: string;
  readonly position: string;
  readonly industry: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly country: string;
  readonly note: string;
}

const CRM_DEFAULTS: CrmDraft = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  company: "",
  position: "",
  industry: "",
  street: "",
  postalCode: "",
  city: "",
  country: "US",
  note: "",
};

// CRM: create contact/lead — many optional fields, grouped by
// person/company/address instead of one long linear list.
function CrmContactForm(): ReactNode {
  const { field } = useDraft<CrmDraft>(CRM_DEFAULTS);
  const { Grid, GridCell } = usePrimitives();
  return (
    <SectionCard title="CRM · Add contact" subtitle="Person, company, address">
      <Grid columns={2}>
        <GridCell>
          <TextField label="First name" {...field("firstName")} />
        </GridCell>
        <GridCell>
          <TextField label="Last name" {...field("lastName")} />
        </GridCell>
        <GridCell>
          <TextField label="Email" {...field("email")} autoComplete="email" />
        </GridCell>
        <GridCell>
          <TextField label="Phone" {...field("phone")} autoComplete="tel" />
        </GridCell>
      </Grid>
      <Grid columns={2}>
        <GridCell>
          <TextField label="Company" {...field("company")} />
        </GridCell>
        <GridCell>
          <TextField label="Position" {...field("position")} />
        </GridCell>
        <GridCell span={2}>
          <SelectField
            label="Industry"
            {...field("industry")}
            options={["Manufacturing", "Retail", "Services", "Healthcare"]}
          />
        </GridCell>
      </Grid>
      <Grid columns={3}>
        <GridCell span={2}>
          <TextField label="Street" {...field("street")} />
        </GridCell>
        <GridCell>
          <TextField label="Postal code" {...field("postalCode")} />
        </GridCell>
        <GridCell span={2}>
          <TextField label="City" {...field("city")} />
        </GridCell>
        <GridCell>
          <SelectField
            label="Country"
            {...field("country")}
            options={[
              { value: "US", label: "United States" },
              { value: "CA", label: "Canada" },
              { value: "GB", label: "United Kingdom" },
            ]}
          />
        </GridCell>
      </Grid>
      <TextareaField label="Note" {...field("note")} rows={3} />
    </SectionCard>
  );
}

interface MaintenanceDraft {
  readonly assetId: string;
  readonly location: string;
  readonly inspectionDate: string;
  readonly temperature: number | undefined;
  readonly pressure: number | undefined;
  readonly vibration: number;
  readonly status: string;
  readonly passed: boolean;
  readonly defects: string;
}

const MAINTENANCE_DEFAULTS: MaintenanceDraft = {
  assetId: "A-2231",
  location: "Bay 3",
  inspectionDate: "2026-07-26",
  temperature: 62,
  pressure: 4.1,
  vibration: 2.5,
  status: "ok",
  passed: true,
  defects: "",
};

// Industry: maintenance / asset check — measurements with units in the
// label, often filled on a tablet on site.
function MaintenanceLogForm(): ReactNode {
  const { draft, field } = useDraft<MaintenanceDraft>(MAINTENANCE_DEFAULTS);
  const { Grid, GridCell } = usePrimitives();
  return (
    <SectionCard title="Industrial · Maintenance log" subtitle="Asset, measurements, result">
      <Grid columns={3}>
        <GridCell>
          <TextField label="Asset ID" {...field("assetId")} />
        </GridCell>
        <GridCell>
          <SelectField
            label="Location"
            {...field("location")}
            options={["Bay 1", "Bay 2", "Bay 3", "Off-site storage"]}
          />
        </GridCell>
        <GridCell>
          <DateField label="Inspection date" {...field("inspectionDate")} />
        </GridCell>
      </Grid>
      <Grid columns={3}>
        <GridCell>
          <NumberField label="Temperature (°C)" {...field("temperature")} />
        </GridCell>
        <GridCell>
          <NumberField label="Pressure (bar)" {...field("pressure")} />
        </GridCell>
        <GridCell>
          <SelectField
            label="Status"
            {...field("status")}
            options={[
              { value: "ok", label: "OK" },
              { value: "warn", label: "Watch" },
              { value: "critical", label: "Critical" },
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
      <BooleanField label="Inspection passed" {...field("passed")} />
      <TextareaField label="Defects" {...field("defects")} rows={3} />
    </SectionCard>
  );
}

interface PatientIntakeDraft {
  readonly patientName: string;
  readonly dateOfBirth: string;
  readonly insurance: string;
  readonly height: number | undefined;
  readonly weight: number | undefined;
  readonly bloodPressure: string;
  readonly pulse: number | undefined;
  readonly allergies: string;
  readonly currentMedication: boolean;
  readonly consentGiven: boolean;
}

const PATIENT_INTAKE_DEFAULTS: PatientIntakeDraft = {
  patientName: "",
  dateOfBirth: "",
  insurance: "public",
  height: undefined,
  weight: undefined,
  bloodPressure: "",
  pulse: undefined,
  allergies: "",
  currentMedication: false,
  consentGiven: false,
};

// Medicine: patient intake — sensitive data clearly separated, many
// required fields, vitals as a narrow four-column row.
function PatientIntakeForm(): ReactNode {
  const { field } = useDraft<PatientIntakeDraft>(PATIENT_INTAKE_DEFAULTS);
  const { Grid, GridCell } = usePrimitives();
  return (
    <SectionCard title="Medical · Patient intake" subtitle="Person, vitals, history">
      <Grid columns={3}>
        <GridCell>
          <TextField label="Name" {...field("patientName")} required />
        </GridCell>
        <GridCell>
          <DateField label="Date of birth" {...field("dateOfBirth")} required />
        </GridCell>
        <GridCell>
          <SelectField
            label="Insurance"
            {...field("insurance")}
            options={[
              { value: "public", label: "Public" },
              { value: "private", label: "Private" },
              { value: "selfPay", label: "Self-pay" },
            ]}
          />
        </GridCell>
      </Grid>
      <Grid columns={4}>
        <GridCell>
          <NumberField label="Height (cm)" {...field("height")} />
        </GridCell>
        <GridCell>
          <NumberField label="Weight (kg)" {...field("weight")} />
        </GridCell>
        <GridCell>
          <TextField label="Blood pressure" {...field("bloodPressure")} placeholder="120/80" />
        </GridCell>
        <GridCell>
          <NumberField label="Pulse (bpm)" {...field("pulse")} />
        </GridCell>
      </Grid>
      <TextareaField label="Allergies" {...field("allergies")} rows={2} />
      <Grid columns={2}>
        <GridCell>
          <BooleanField label="Currently on medication" {...field("currentMedication")} />
        </GridCell>
        <GridCell>
          <BooleanField label="Consent given" {...field("consentGiven")} />
        </GridCell>
      </Grid>
    </SectionCard>
  );
}

interface IncidentLogDraft {
  readonly title: string;
  readonly date: string;
  readonly category: string;
  readonly participants: string;
  readonly description: string;
  readonly followUpNeeded: boolean;
  readonly escalated: boolean;
  readonly closed: boolean;
}

const INCIDENT_LOG_DEFAULTS: IncidentLogDraft = {
  title: "",
  date: "2026-07-26",
  category: "meeting",
  participants: "",
  description: "",
  followUpNeeded: false,
  escalated: false,
  closed: false,
};

// Protocol: meeting / incident log — free-text heavy, checklist as a
// compact boolean row instead of a custom multi-select.
function IncidentLogForm(): ReactNode {
  const { field } = useDraft<IncidentLogDraft>(INCIDENT_LOG_DEFAULTS);
  const { Grid, GridCell } = usePrimitives();
  return (
    <SectionCard title="Log · Meeting/incident log" subtitle="Meta, timeline, actions">
      <Grid columns={3}>
        <GridCell span={2}>
          <TextField label="Title" {...field("title")} />
        </GridCell>
        <GridCell>
          <DateField label="Date" {...field("date")} />
        </GridCell>
      </Grid>
      <Grid columns={3}>
        <GridCell span={2}>
          <TextField
            label="Participants"
            {...field("participants")}
            placeholder="Comma-separated"
          />
        </GridCell>
        <GridCell>
          <SelectField
            label="Category"
            {...field("category")}
            options={[
              { value: "meeting", label: "Meeting" },
              { value: "incident", label: "Incident" },
              { value: "review", label: "Review" },
            ]}
          />
        </GridCell>
      </Grid>
      <TextareaField label="Description" {...field("description")} rows={6} />
      <Grid columns={3}>
        <GridCell>
          <BooleanField label="Follow-up needed" {...field("followUpNeeded")} />
        </GridCell>
        <GridCell>
          <BooleanField label="Escalated" {...field("escalated")} />
        </GridCell>
        <GridCell>
          <BooleanField label="Closed" {...field("closed")} />
        </GridCell>
      </Grid>
    </SectionCard>
  );
}
