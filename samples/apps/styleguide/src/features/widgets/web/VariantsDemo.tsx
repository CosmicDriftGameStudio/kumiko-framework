// Opt-in widget variants, one block each, for screenshot review.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  Composer,
  DetailList,
  ModeSwitch,
  SectionCard,
  TextareaField,
} from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";

type DemoMode = "auto" | "manual" | "questions" | "locked";

export function VariantsDemo(): ReactNode {
  const t = useTranslation();
  const { Heading, Banner } = usePrimitives();
  const [mode, setMode] = useState<DemoMode>("auto");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  const detailRows = [
    {
      label: t("widgets:catalog:variants-label-owner"),
      value: t("widgets:catalog:variants-value-owner"),
    },
    {
      label: t("widgets:catalog:variants-label-region"),
      value: t("widgets:catalog:variants-value-region"),
    },
    {
      label: t("widgets:catalog:variants-label-plan"),
      value: t("widgets:catalog:variants-value-plan"),
    },
  ];

  return (
    <SectionCard title={t("widgets:catalog:variants-title")} testId="variants-demo">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2" data-testid="variants-heading">
          <Heading variant="group">{t("widgets:catalog:variants-heading-group")}</Heading>
          <Heading variant="section">{t("widgets:catalog:variants-heading-section")}</Heading>
        </div>

        <div className="grid gap-6 md:grid-cols-[1fr_280px]">
          <div data-testid="variants-detail-normal">
            <Heading variant="group">{t("widgets:catalog:variants-detail-normal")}</Heading>
            <DetailList rows={detailRows} valueWeight="normal" />
          </div>
          <div data-testid="variants-detail-sidebar">
            <Heading variant="group">{t("widgets:catalog:variants-detail-sidebar")}</Heading>
            <DetailList rows={detailRows} valueWeight="normal" layout="sidebar" />
          </div>
        </div>

        <div className="flex flex-col gap-2" data-testid="variants-mode-switch">
          <Heading variant="group">{t("widgets:catalog:variants-mode-switch")}</Heading>
          <ModeSwitch
            value={mode}
            onChange={setMode}
            options={[
              { value: "auto", label: t("widgets:catalog:variants-mode-a") },
              { value: "manual", label: t("widgets:catalog:variants-mode-b") },
              { value: "questions", label: t("widgets:catalog:variants-mode-c"), tone: "warning" },
              { value: "locked", label: t("widgets:catalog:variants-mode-d"), disabled: true },
            ]}
          />
        </div>

        <div data-testid="variants-banner">
          <Banner
            variant="warning"
            icon="alert-triangle"
            parts={[
              { text: t("widgets:catalog:variants-banner-lead") },
              { text: t("widgets:catalog:variants-banner-strong"), strong: true },
              { text: t("widgets:catalog:variants-banner-tail") },
            ]}
          />
        </div>

        <TextareaField
          label={t("widgets:catalog:variants-textarea-placeholder")}
          id="variants-textarea"
          name="variants-textarea"
          value={note}
          onChange={setNote}
          placeholder={t("widgets:catalog:variants-textarea-hint")}
          testId="variants-textarea"
        />

        <div className="flex min-h-40 flex-col" data-testid="variants-composer-host">
          <Heading variant="group">{t("widgets:catalog:variants-composer")}</Heading>
          <Composer
            value={message}
            onChange={setMessage}
            onSubmit={() => setMessage("")}
            placeholder={t("widgets:catalog:variants-composer-placeholder")}
            submitLabel={t("widgets:catalog:variants-composer-send")}
            testId="variants-composer"
          />
        </div>
      </div>
    </SectionCard>
  );
}
