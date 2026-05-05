import { usePrimitives } from "@cosmicdrift/kumiko-renderer";
import type { ReactNode } from "react";
import { DemoPage, DemoSection } from "../components/page";

export function TextDemo(): ReactNode {
  const { Text } = usePrimitives();
  return (
    <DemoPage title="Text" description="Variants body / small / code / required-mark.">
      <DemoSection title="Body (default)">
        <Text>Standard Body-Text in der App-Schrift.</Text>
      </DemoSection>
      <DemoSection title="Small">
        <Text variant="small">Kleinerer, gedämpfter Text — Hint, Helper, Caption.</Text>
      </DemoSection>
      <DemoSection title="Code">
        <Text>
          Wert kommt aus <Text variant="code">field.values.title</Text>.
        </Text>
      </DemoSection>
      <DemoSection title="Required-Mark">
        <Text>
          Title <Text variant="required-mark">*</Text>
        </Text>
      </DemoSection>
    </DemoPage>
  );
}
