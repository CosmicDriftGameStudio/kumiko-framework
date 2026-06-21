// @runtime client
// RequestAccountDeletionScreen — anonymer Apex-Screen Schritt 1. Email-Form
// → user-data-rights:write:request-deletion-by-email. Enumeration-safe: zeigt
// unconditional ein "Falls Account existiert, Mail unterwegs"-Confirm, auch
// wenn der Server intern erkannt hat dass die Email nicht existiert.
//
// App mountet den Screen unter einer Apex-Route (z.B. /delete-account) via
// createPublicSurface; die Page-Shell liefert die Chrome.

import { useDispatcher, usePrimitives, useTranslation } from "@cosmicdrift/kumiko-renderer";
import { type FormEvent, type ReactNode, useState } from "react";

const REQUEST_BY_EMAIL = "user-data-rights:write:request-deletion-by-email";

export type RequestAccountDeletionScreenProps = {
  readonly title?: string;
};

export function RequestAccountDeletionScreen({
  title,
}: RequestAccountDeletionScreenProps): ReactNode {
  const t = useTranslation();
  const dispatcher = useDispatcher();
  const { Form, Field, Input, Button, Banner, Card } = usePrimitives();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSubmit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await dispatcher.write(REQUEST_BY_EMAIL, { email });
      if (res.isSuccess) {
        setDone(true);
      } else {
        setError(t("userDataRights.deletion.request.error"));
      }
    } catch {
      setError(t("userDataRights.deletion.request.error"));
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = (e?: FormEvent): void => {
    e?.preventDefault();
    void doSubmit();
  };

  return (
    <Card
      className="w-full max-w-sm mx-auto"
      options={{ padded: false }}
      slots={{
        header: (
          <div className="flex flex-col space-y-1.5 p-6 pb-4">
            <h1 className="text-xl font-semibold tracking-tight">
              {title ?? t("userDataRights.deletion.request.title")}
            </h1>
          </div>
        ),
      }}
    >
      {done ? (
        <div className="p-6 pt-0">
          <Banner variant="info">
            <p className="font-medium text-foreground">
              {t("userDataRights.deletion.request.successTitle")}
            </p>
            <p className="mt-1">{t("userDataRights.deletion.request.successBody")}</p>
          </Banner>
        </div>
      ) : (
        <div className="p-6 pt-0 flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            {t("userDataRights.deletion.request.intro")}
          </p>
          <Form onSubmit={onSubmit}>
            <Field id="delete-email" label={t("userDataRights.deletion.request.email")} required>
              <Input
                kind="text"
                id="delete-email"
                name="delete-email"
                value={email}
                onChange={setEmail}
                disabled={submitting}
                required
              />
            </Field>
            {error !== null && <Banner variant="error">{error}</Banner>}
            <Button type="submit" loading={submitting} disabled={submitting}>
              {submitting
                ? t("userDataRights.deletion.request.submitting")
                : t("userDataRights.deletion.request.submit")}
            </Button>
          </Form>
        </div>
      )}
    </Card>
  );
}
