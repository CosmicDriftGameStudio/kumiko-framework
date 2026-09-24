import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { Project } from "ts-morph";
import { guard } from "../guard-no-framed-extension-sections";

function parse(source: string, file = "src/features/demo/web/client-plugin.tsx") {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(path.join(process.cwd(), file), source);
}

describe("guard-no-framed-extension-sections", () => {
  test("flags a registered extension-section component rendering its own Card", () => {
    const sf = parse(
      `function NotesSection() { return <Card slots={{ title: "Notes" }}>x</Card>; }
export function demoClient() {
  return { extensionSectionComponents: { notes: NotesSection } };
}`,
    );
    const violations = guard.run([sf]).violations;
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toContain("NotesSection");
    expect(violations[0]?.message).toContain("Card");
  });

  test("flags SectionCard and CollapsibleSection the same way", () => {
    const sf = parse(
      `const NotesSection = () => <SectionCard>x</SectionCard>;
const HistorySection = () => <CollapsibleSection>y</CollapsibleSection>;
export function demoClient() {
  return { extensionSectionComponents: { notes: NotesSection, history: HistorySection } };
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(2);
  });

  test("shorthand registration ({ NotesSection }) is resolved too", () => {
    const sf = parse(
      `function NotesSection() { return <Card>x</Card>; }
export function demoClient() {
  return { extensionSectionComponents: { NotesSection } };
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(1);
  });

  test("allows the same component using plain containers instead of a card", () => {
    const sf = parse(
      `function NotesSection() { return <div className="flex flex-col gap-3"><Heading>Notes</Heading>x</div>; }
export function demoClient() {
  return { extensionSectionComponents: { notes: NotesSection } };
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("a component with the same JSX that is NOT registered as an extension section is ignored", () => {
    const sf = parse(
      `function StandaloneScreen() { return <Card slots={{ title: "Notes" }}>x</Card>; }
export function demoClient() {
  return { extensionSectionComponents: {} };
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("a file with no extensionSectionComponents registration at all is a no-op", () => {
    const sf = parse("function NotesSection() { return <Card>x</Card>; }");
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("resolves a registration imported through a barrel (client-app.tsx style component map)", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const featureFile = project.createSourceFile(
      path.join(process.cwd(), "src/features/vehicle/web/vehicle-hub-header.tsx"),
      `export function VehicleHubHeader() { return <Card slots={{ title: "Vehicle" }}>x</Card>; }`,
    );
    project.createSourceFile(
      path.join(process.cwd(), "src/features/vehicle/web/index.ts"),
      `export { VehicleHubHeader } from "./vehicle-hub-header";`,
    );
    const clientApp = project.createSourceFile(
      path.join(process.cwd(), "src/client-app.tsx"),
      `import { VehicleHubHeader } from "./features/vehicle/web";
export function clientApp() {
  return { extensionSectionComponents: { vehicleHub: VehicleHubHeader } };
}`,
    );
    const violations = guard.run([clientApp, featureFile]).violations;
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toContain("vehicle-hub-header.tsx");
    expect(violations[0]?.message).toContain("VehicleHubHeader");
  });

  test("follows a registered component that delegates the Card to a child component", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const galleryFile = project.createSourceFile(
      path.join(process.cwd(), "src/features/vehicle-photos/web/vehicle-photo-gallery.tsx"),
      `export function VehiclePhotoGallery() { return <SectionCard>x</SectionCard>; }`,
    );
    const sectionFile = project.createSourceFile(
      path.join(process.cwd(), "src/features/vehicle/web/vehicle-photos-section.tsx"),
      `import { VehiclePhotoGallery } from "../../vehicle-photos/web/vehicle-photo-gallery";
export function VehiclePhotosSection() { return <VehiclePhotoGallery />; }`,
    );
    const clientApp = project.createSourceFile(
      path.join(process.cwd(), "src/client-app.tsx"),
      `import { VehiclePhotosSection } from "./features/vehicle/web/vehicle-photos-section";
export function clientApp() {
  return { extensionSectionComponents: { photos: VehiclePhotosSection } };
}`,
    );
    const violations = guard.run([clientApp, sectionFile, galleryFile]).violations;
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toContain("vehicle-photo-gallery.tsx");
    expect(violations[0]?.message).toContain("VehiclePhotosSection");
    expect(violations[0]?.message).toContain("via VehiclePhotosSection -> VehiclePhotoGallery");
  });

  test("a registration value imported from an external package (constant-keyed) is not flagged", () => {
    const sf = parse(
      `import { NotesSection, NOTES_SECTION_EXTENSION_NAME } from "@cosmicdrift/kumiko-bundled-features/notes-history";
export function demoClient() {
  return { extensionSectionComponents: { [NOTES_SECTION_EXTENSION_NAME]: NotesSection } };
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });

  test("ignore tag on the JSX element suppresses the finding", () => {
    const sf = parse(
      `function NotesSection() {
	// kumiko-lint-ignore no-framed-extension-sections legacy bridge, migrates in fw#9999
	return <Card>x</Card>;
}
export function demoClient() {
  return { extensionSectionComponents: { notes: NotesSection } };
}`,
    );
    expect(guard.run([sf]).violations).toHaveLength(0);
  });
});
