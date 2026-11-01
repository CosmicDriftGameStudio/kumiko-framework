# Recipe: helpdesk

Public contact form backend. The `helpdesk` bundled feature stores questions, contact
requests and problem reports from website visitors and notifies every SystemAdmin (mail,
Telegram only when the app turns it on). The notification names only the kind, the app and a link into the inbox:
no name, address, phone, subject or message. Telegram is a third party where nothing can be
shredded or recalled, so it gets the same minimal text. Website senders get a fixed
acknowledgement that repeats nothing they typed; signed-in admin reports get a copy.
SystemAdmins reply from the admin. Phone is off and Telegram is not mounted unless the app
turns them on (`fields.phone`, `telegram: true`).

**What the recipe demonstrates:**
- Mounting `createHelpdeskFeature` with its companions (delivery, user-data-rights, files)
- The anonymous flow: `helpdesk:query:challenge` hands out a proof-of-work challenge,
  `helpdesk:write:submit` verifies it; spam gets the same 200 body and stores nothing
- The browser client at `GET /helpdesk/client.js` (`window.KumikoHelpdesk.load()` / `submit()`)

## Layout

```
samples/recipes/helpdesk/
├── package.json
├── README.md
└── src/
    ├── feature.ts                      # createHelpdeskFeature options
    └── __tests__/
        └── feature.integration.test.ts # challenge query + client route
```

The behavior (submit, silent drops, replies, Telegram, GDPR export and erasure, retention) is
covered by the integration tests next to the feature in
`packages/bundled-features/src/helpdesk/__tests__/`.

## Run tests

```bash
bun test --config=bunfig.integration.toml samples/recipes/helpdesk
```

## Integration into a real app

1. Mount `createHelpdeskFeature({ appName })` plus delivery, a mail channel, `user-data-rights`,
   `files` with a file provider and `config`.
2. Run `kumiko schema generate` (new tables, plus the delivery `idempotency_key` column).
3. SystemAdmins set `helpdesk:config:reply-to` in the admin.
4. Embed `/helpdesk/client.js` on the website; the form is yours. A website served by another
   server can serve the same script from `HELPDESK_CLIENT_SOURCE` and type its calls with
   `HelpdeskWebsiteClient`, both from `@cosmicdrift/kumiko-bundled-features/helpdesk/client`.

Telegram is optional and off by default: notifications go by mail to SystemAdmins only. An app
that turns it on (`telegram: true`) also mounts `channel-telegram` and `secrets` for the bot
token, and SystemAdmins set `helpdesk:config:telegram-chat`.
