import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { type ReactNode, useState } from "react";
import { DemoPage, DemoSection } from "../components/page";

export function ButtonsDemo(): ReactNode {
  const { Button } = usePrimitives();
  const [loading, setLoading] = useState(false);

  async function simulateAsync(): Promise<void> {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1500));
    setLoading(false);
  }

  return (
    <DemoPage
      title="Buttons"
      description="Drei Variants — primary, secondary, danger — plus disabled- und loading-State."
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
      <DemoSection title="Loading (Spinner)">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => void simulateAsync()} loading={loading}>
            {loading ? "Speichere…" : "Async-Action (1.5s)"}
          </Button>
          <Button variant="secondary" loading>
            Secondary loading
          </Button>
          <Button variant="danger" loading>
            Danger loading
          </Button>
        </div>
      </DemoSection>
    </DemoPage>
  );
}
