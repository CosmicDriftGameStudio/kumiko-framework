// Public waitlist sign-up: posts anonymously to waitlist:write:submit and then shows a
// confirmation. The server answers identically for new, duplicate and honeypot submits.

import { AuthCard } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import {
  useMutation,
  useOptionalLocale,
  usePrimitives,
  useTranslation,
} from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import { WaitlistHandlers } from "./constants.ts";

export type WaitlistSubmitScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  /** href for the "Already have an account?" link; defaults to "/login". */
  readonly loginHref?: string;
};

const HONEYPOT_STYLE = { position: "absolute", left: "-10000px", width: 1, height: 1 } as const;

export function WaitlistSubmitScreen({
  title,
  subtitle,
  loginHref = "/login",
}: WaitlistSubmitScreenProps): ReactNode {
  const t = useTranslation();
  const locale = useOptionalLocale() ?? "en";
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const submit = useMutation(WaitlistHandlers.submit);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState("");
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    setFailed(false);
    void submit
      .mutate({
        name,
        email,
        locale,
        ...(company.trim() !== "" && { company }),
        ...(message.trim() !== "" && { message }),
        ...(website !== "" && { website }),
      })
      .then((result) => {
        if (result.isSuccess) setDone(true);
        else setFailed(true);
      });
  };

  return (
    <AuthCard title={title ?? t("waitlist.public.title")} subtitle={subtitle}>
      {done ? (
        <>
          <Banner variant="info">
            <p className="font-medium text-foreground">{t("waitlist.public.successTitle")}</p>
            <p className="mt-1">{t("waitlist.public.successBody")}</p>
          </Banner>
          <Link href={loginHref} variant="muted">
            {t("waitlist.public.haveAccount")}
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t("waitlist.public.intro")}</p>
          <Form onSubmit={onSubmit}>
            <Field id="waitlist-name" label={t("waitlist.public.name")} required>
              <Input
                kind="text"
                id="waitlist-name"
                name="waitlist-name"
                value={name}
                onChange={setName}
                disabled={submit.pending}
                required
                autoComplete="name"
              />
            </Field>
            <Field id="waitlist-email" label={t("waitlist.public.email")} required>
              <Input
                kind="email"
                id="waitlist-email"
                name="waitlist-email"
                value={email}
                onChange={setEmail}
                disabled={submit.pending}
                required
                autoComplete="email"
              />
            </Field>
            <Field id="waitlist-company" label={t("waitlist.public.company")}>
              <Input
                kind="text"
                id="waitlist-company"
                name="waitlist-company"
                value={company}
                onChange={setCompany}
                disabled={submit.pending}
                autoComplete="organization"
              />
            </Field>
            <Field id="waitlist-message" label={t("waitlist.public.message")}>
              <Input
                kind="textarea"
                id="waitlist-message"
                name="waitlist-message"
                value={message}
                onChange={setMessage}
                disabled={submit.pending}
                rows={4}
              />
            </Field>
            <div aria-hidden="true" style={HONEYPOT_STYLE}>
              <input
                id="waitlist-website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>
            {failed && <Banner variant="error">{t("waitlist.public.error")}</Banner>}
            <Button type="submit" loading={submit.pending} disabled={submit.pending}>
              {submit.pending ? t("waitlist.public.submitting") : t("waitlist.public.submit")}
            </Button>
          </Form>
          <Link href={loginHref} variant="muted" className="self-center">
            {t("waitlist.public.haveAccount")}
          </Link>
        </>
      )}
    </AuthCard>
  );
}
