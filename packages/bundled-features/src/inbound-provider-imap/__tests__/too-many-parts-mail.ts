// mailparser throws once a mail has more than this many MIME nodes, the multipart root included.
export const MAILPARSER_MAX_MIME_NODES = 1000;

/** A multipart/mixed mail with `partCount` text parts below its root. */
export function buildMailWithTooManyParts(partCount: number): Uint8Array {
  const parts = Array.from(
    { length: partCount },
    (_, index) => `--P\r\nContent-Type: text/plain; charset=utf-8\r\n\r\npart ${index}\r\n`,
  );
  const mail = [
    "From: Alice <alice@example.com>\r\n",
    "To: testuser@example.com\r\n",
    "Subject: Pathological structure\r\n",
    "Message-ID: <poison@fixture.test>\r\n",
    "Date: Mon, 06 Jul 2026 10:00:00 +0000\r\n",
    "MIME-Version: 1.0\r\n",
    'Content-Type: multipart/mixed; boundary="P"\r\n',
    "\r\n",
    ...parts,
    "--P--\r\n",
  ].join("");
  return new TextEncoder().encode(mail);
}
