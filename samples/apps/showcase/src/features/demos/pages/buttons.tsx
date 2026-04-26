import { usePrimitives } from "@kumiko/renderer";
import type { ReactNode } from "react";
import { DemoPage, DemoSection } from "../components/page";

export function ButtonsDemo(): ReactNode {
  const { Button } = usePrimitives();
  return (
    <DemoPage
      title="Buttons"
      description="Drei Variants — primary, secondary, danger — plus disabled-State."
    >
      <DemoSection title="Variants">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger">Danger</Button>
        </div>
      </DemoSection>
      <DemoSection title="Disabled">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled>
            Primary
          </Button>
          <Button variant="secondary" disabled>
            Secondary
          </Button>
          <Button variant="danger" disabled>
            Danger
          </Button>
        </div>
      </DemoSection>
    </DemoPage>
  );
}
