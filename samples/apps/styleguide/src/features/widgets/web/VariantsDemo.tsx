// Opt-in widget variants, one block each, for screenshot review.

import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import {
  ChoiceCards,
  Composer,
  DetailList,
  ModeSwitch,
  PageSection,
  SectionCard,
  SectionNavLayout,
  SideBySideTable,
  StepBar,
  TextareaField,
} from "@cosmicdrift/kumiko-renderer/web";
import { type ReactNode, useState } from "react";

type DemoMode = "auto" | "manual" | "questions" | "locked";

type DemoChoice = "empty" | "service" | "guests";

export function VariantsRoundTwoDemo(): ReactNode {
  const t = useTranslation();
  const { Heading, Banner, Button, Text } = usePrimitives();
  const [choice, setChoice] = useState<DemoChoice | null>("service");
  const [mode, setMode] = useState<DemoMode>("manual");
  const [message, setMessage] = useState("");

  return (
    <SectionCard title={t("widgets:catalog:variants-round2-title")} testId="variants-round2-demo">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2" data-testid="variants-choice">
          <Heading variant="group">{t("widgets:catalog:variants-choice")}</Heading>
          <ChoiceCards
            value={choice}
            onChange={setChoice}
            columns={3}
            variant="radio"
            label={t("widgets:catalog:variants-choice-label")}
            options={[
              {
                value: "empty",
                title: t("widgets:catalog:variants-choice-empty"),
                description: t("widgets:catalog:variants-choice-empty-desc"),
              },
              {
                value: "service",
                title: t("widgets:catalog:variants-choice-service"),
                description: t("widgets:catalog:variants-choice-service-desc"),
              },
              {
                value: "guests",
                title: t("widgets:catalog:variants-choice-guests"),
                description: t("widgets:catalog:variants-choice-guests-desc"),
              },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2" data-testid="variants-mode-wide">
          <Heading variant="group">{t("widgets:catalog:variants-mode-wide")}</Heading>
          <ModeSwitch
            value={mode}
            onChange={setMode}
            segmentWidth="wide"
            className="w-fit"
            options={[
              { value: "auto", label: t("widgets:catalog:variants-mode-a") },
              { value: "manual", label: t("widgets:catalog:variants-mode-b") },
              { value: "questions", label: t("widgets:catalog:variants-mode-c"), tone: "warning" },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2" data-testid="variants-compare">
          <Heading variant="group">{t("widgets:catalog:variants-compare")}</Heading>
          <SideBySideTable
            caption={t("widgets:catalog:variants-compare")}
            rowHeaderLabel={t("widgets:catalog:variants-compare-field")}
            rowHeaderTone="foreground"
            columns={[
              { id: "doc", label: t("widgets:catalog:variants-compare-left") },
              { id: "stock", label: t("widgets:catalog:variants-compare-right") },
            ]}
            rows={[
              {
                id: "name",
                header: t("widgets:catalog:variants-compare-name"),
                cells: [{ content: t("widgets:catalog:variants-value-owner"), colSpan: 2 }],
              },
              {
                id: "city",
                header: t("widgets:catalog:variants-compare-city"),
                cells: [{ content: "Frankfurt" }, { content: "Hamburg" }],
              },
            ]}
          />
        </div>

        <div className="flex flex-col gap-2" data-testid="variants-docked">
          <Heading variant="group">{t("widgets:catalog:variants-docked")}</Heading>
          <div className="h-64 overflow-y-auto rounded-md border border-border">
            <PageSection className="flex min-h-full flex-col">
              {Array.from({ length: 12 }, (_, index) => (
                <Text key={`line-${index.toString()}`} variant="muted">
                  {t("widgets:catalog:variants-docked-message")}
                </Text>
              ))}
              <Composer
                docked
                value={message}
                onChange={setMessage}
                onSubmit={() => setMessage("")}
                placeholder={t("widgets:catalog:variants-composer-placeholder")}
                submitLabel={t("widgets:catalog:variants-composer-send")}
                testId="variants-docked-composer"
              />
            </PageSection>
          </div>
        </div>

        <div className="flex flex-col gap-2" data-testid="variants-banner-below">
          <Heading variant="group">{t("widgets:catalog:variants-banner-below")}</Heading>
          <Banner
            variant="error"
            icon="alert-triangle"
            title={t("widgets:catalog:variants-banner-below-title")}
            actionsPlacement="below"
            actions={
              <Button variant="secondary" size="sm">
                {t("widgets:catalog:variants-banner-below-action")}
              </Button>
            }
          >
            {t("widgets:catalog:variants-banner-below-body")}
          </Banner>
        </div>

        <div className="flex flex-col gap-2" data-testid="variants-rail">
          <Heading variant="group">{t("widgets:catalog:variants-rail")}</Heading>
          <div className="flex h-96 border border-border">
            <StepBar
              orientation="vertical"
              steps={[
                t("widgets:catalog:variants-rail-step-one"),
                t("widgets:catalog:variants-rail-step-two"),
              ]}
              currentIndex={0}
              compactLabel={t("widgets:catalog:variants-rail-heading")}
              heading={t("widgets:catalog:variants-rail-heading")}
              subtitles={[undefined, t("widgets:catalog:variants-rail-subtitle")]}
              upNext={{
                heading: t("widgets:catalog:variants-rail-up-next"),
                title: t("widgets:catalog:variants-rail-step-two"),
                subtitle: t("widgets:catalog:variants-rail-hint"),
              }}
              testId="variants-rail-steps"
            />
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

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

  const navSections = ["profile", "billing", "security"].map((id) => ({
    id: `variants-nav-${id}`,
    title: t(`widgets:catalog:variants-nav-${id}`),
  }));

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

        <div className="flex flex-col gap-2" data-testid="variants-section-nav">
          <Heading variant="group">{t("widgets:catalog:variants-section-nav")}</Heading>
          <SectionNavLayout items={navSections} testId="variants-section-nav-layout">
            {navSections.map((section) => (
              <section key={section.id} id={section.id} className="flex flex-col gap-1">
                <Heading variant="group">{section.title}</Heading>
                <p className="text-sm text-muted-foreground">
                  {t("widgets:catalog:variants-nav-body")}
                </p>
              </section>
            ))}
          </SectionNavLayout>
        </div>
      </div>
    </SectionCard>
  );
}
