import { usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";
import type { AuthTokenResult } from "./auth-client.ts";
import { AuthCard } from "./auth-form-primitives.tsx";

export type EmailRequestTextKeys = {
  readonly title: string;
  readonly intro: string;
  readonly email: string;
  readonly submit: string;
  readonly submitting: string;
  readonly successTitle: string;
  readonly successBody: string;
  readonly backToLogin: string;
  readonly rateLimitedWithMinutes: string;
};

export type EmailRequestScreenProps = {
  readonly title?: string;
  readonly subtitle?: ReactNode;
  readonly loginHref: string;
  readonly fieldId: string;
  readonly textKeys: EmailRequestTextKeys;
  readonly submitEmail: (email: string) => Promise<AuthTokenResult>;
};

// Shared by the silent-success email forms (forgot password, account unlock): the UI shows the
// same confirmation whether or not the address belongs to an account.
export function EmailRequestScreen({
  title,
  subtitle,
  loginHref,
  fieldId,
  textKeys,
  submitEmail,
}: EmailRequestScreenProps): ReactNode {
  const t = useTranslation();
  const { Form, Field, Input, Button, Banner, Link } = usePrimitives();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitEmail(email);
      if (res.ok) {
        setDone(true);
      } else if (res.error.reason === "rate_limited") {
        const minutes =
          res.error.retryAfterSeconds !== undefined
            ? Math.ceil(res.error.retryAfterSeconds / 60)
            : undefined;
        setError(
          minutes !== undefined
            ? t(textKeys.rateLimitedWithMinutes, { minutes })
            : t("auth.errors.rateLimited"),
        );
      } else {
        setError(t("auth.errors.unknownError"));
      }
    } catch {
      setError(t("auth.errors.unknownError"));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void doSubmit();
  };

  const effectiveTitle = title ?? t(textKeys.title);

  return (
    <AuthCard title={effectiveTitle} subtitle={subtitle}>
      {done ? (
        <>
          <Banner variant="info">
            <p className="font-medium text-foreground">{t(textKeys.successTitle)}</p>
            <p className="mt-1">{t(textKeys.successBody)}</p>
          </Banner>
          <Link href={loginHref} variant="muted">
            {t(textKeys.backToLogin)}
          </Link>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t(textKeys.intro)}</p>
          <Form onSubmit={onSubmit}>
            <Field id={fieldId} label={t(textKeys.email)} required>
              <Input
                kind="text"
                id={fieldId}
                name={fieldId}
                value={email}
                onChange={setEmail}
                disabled={submitting}
                required
              />
            </Field>
            {error !== null && <Banner variant="error">{error}</Banner>}
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting ? t(textKeys.submitting) : t(textKeys.submit)}
            </Button>
          </Form>
          <Link href={loginHref} variant="muted" className="self-center">
            {t(textKeys.backToLogin)}
          </Link>
        </>
      )}
    </AuthCard>
  );
}
