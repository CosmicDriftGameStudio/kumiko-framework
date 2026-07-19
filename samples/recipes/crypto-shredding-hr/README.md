# Crypto-shredding (mini HR)

Make GDPR forget a key-erase instead of a data-hunt. Fields annotated as PII
are encrypted under a per-subject key (DEK); forgetting the subject erases
that key in the KMS — the ciphertext stays in rows and events but is
unreadable forever, and reads render the `[[erased]]` sentinel.

The recipe ships a mini HR feature: an `employee` entity whose name and email
are the employee's own PII, and an `hr-comment` entity whose body is
encrypted under the key of the employee the comment is *about* — so a
manager's comment dies with the employee's key, not the manager's.

## What it shows

- **`pii: true` on a field** — encrypted under the subject key of its own
  row (`user:<row.id>`). At rest the column holds a
  `kumiko-pii:v1:<subjectKey>:<ciphertext>` envelope; the API returns
  plaintext as long as the key exists.
- **`userOwned: { ownerField }`** — encrypted under the key of the user
  another field points at. Erasing that user's key makes every row about
  them unreadable, with no per-row cleanup hunt.
- **Plain fields stay queryable** — `department` is not personal data, so it
  remains plaintext, sortable and searchable.
- **`lookupable: true` on an encrypted field** — the framework maintains an
  HMAC blind-index column (`email_bidx`), so equality lookups (login, dedup
  checks) keep working on ciphertext: the query compiler rewrites
  `email = $1` to `(email = $1 OR email_bidx = hmac($1))`. Needs
  `runProdApp({ blindIndexKey })` (a dedicated 32-byte key, NOT the KEK).
  Substring search and sorting stay impossible by design — the boot
  validator rejects `searchable`/`sortable` on encrypted fields.
- **Forget = `kms.eraseKey(subject)`** — afterwards detail *and* list render
  `[[erased]]` for every protected field while the stored ciphertext bytes
  stay untouched.

## Feature composition

```
hr → employee (displayName/email pii) + hr-comment (body userOwned)
```

Requires a KMS adapter: `runProdApp({ kms: createPgKmsAdapter(...) })` in
production, `configurePiiSubjectKms(new InMemoryKmsAdapter())` in tests.
Without one, fields are stored in plaintext and a boot warning is logged.
The `crypto-shredding` bundled feature ships the operator `forget-subject`
command; `user-data-rights` erases user keys automatically after the
deletion grace period.

## Flow

1. Create an employee → the executor creates a subject key on first insert
   and stores `displayName`/`email` as ciphertext.
2. A comment about the employee is encrypted under the *employee's* key via
   `userOwned: { ownerField: "employeeId" }`.
3. `kms.eraseKey({ kind: "user", userId })` — idempotent, tombstone stays
   for the audit trail.
4. Detail responses (list, too, for `employee`) now show `[[erased]]` for every field the key
   protected; events and rows keep their original (unreadable) bytes.
5. Lookups by email stop matching after the forget: the pipeline nulls the
   blind index immediately (`nullBlindIndexesForSubject`), and every
   projection rebuild recomputes it from the (now undecryptable) ciphertext
   to `NULL`.
