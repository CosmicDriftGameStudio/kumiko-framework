import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { DemoPage, DemoSection } from "../components/page";

export function BannerDemo(): ReactNode {
  const { Banner, Button, Text } = usePrimitives();
  return (
    <DemoPage
      title="Banner"
      description="Variants info / error, mit optionalem Action-Slot rechts."
    >
      <DemoSection title="Info">
        <Banner variant="info">
          <Text>Das ist eine Info-Nachricht.</Text>
        </Banner>
      </DemoSection>
      <DemoSection title="Error">
        <Banner variant="error">
          <Text>Etwas ist schiefgegangen.</Text>
        </Banner>
      </DemoSection>
      <DemoSection title="Error mit Action">
        <Banner
          variant="error"
          actions={
            <Button variant="secondary" onClick={() => undefined}>
              Neu laden
            </Button>
          }
        >
          <Text>Optimistic Lock — Datensatz wurde geändert.</Text>
        </Banner>
      </DemoSection>
    </DemoPage>
  );
}
