# handbook-knowledge

Gives the AI agent the app's handbook: two read-only query tools, built from the
JSON that `kumiko handbuch knowledge` writes. No table, no migration, no search
index. The model picks the page itself from the catalog of titles and questions.

## Setup

1. Add the process pages to the handbook config (`processTextsDir`, with `{locale}`):

   ```json
   { "textsDir": "docs/handbuch/{locale}", "processTextsDir": "docs/handbuch/{locale}/prozesse" }
   ```

   A process page is a Markdown file with frontmatter `titel`, `gruppe: aufgaben`,
   `fragen` (the questions it answers), `masken` (screen ids, in order) and optionally
   `start` (the qualified name of the write handler that begins the task, e.g.
   `ai-orchestration:write:start-move-out`). The assistant answers with the page's
   steps, links the page and offers to start the task as a plan through exactly that
   handler, the same one the screen calls; the framework does not validate the name. Without
   `processTextsDir` the handbook build is unchanged.

2. Export the knowledge file (deterministic, one list per locale, images removed):

   ```sh
   kumiko handbuch knowledge handbuch.json --out src/handbook-knowledge.json
   ```

3. Mount the feature:

   ```typescript
   import { createHandbookKnowledgeFeature } from "@cosmicdrift/kumiko-bundled-features/handbook-knowledge";
   import pages from "./handbook-knowledge.json";

   createHandbookKnowledgeFeature({
     pages,
     access: { roles: ["Member", "Admin"] },
     publicPath: "/handbuch",
   });
   ```

   `pages` is validated once at boot. `access` is the declarative access of both
   handlers; the agent tool catalog only contains the tools for roles it admits.
   `publicPath` is optional; page links are `<publicPath>/<page id>`, with or without a trailing slash.

## Handlers

| Handler                               | Payload  | Returns                                                                                               |
| ------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `handbook-knowledge:query:list-pages` | none     | `locale`, `pages[]` with `id`, `kind` (`process` or `screen`), `title`, `questions`, `start` when set |
| `handbook-knowledge:query:read-page`  | `{ id }` | the page with `bodyMd`, `start` when set, `locale`, `truncated`, `notice`, `publicPath`               |

- Language: the caller's `ctx.locale` (`de-AT` serves `de`). A language or page the
  handbook lacks falls back to the default language.
- `read-page` cuts a body at `HANDBOOK_PAGE_MAX_CHARS` (12000) at a paragraph break
  and says so in `notice`. An unknown `id` is a `not_found` error.
- Both handlers carry a `description` that tells the model to use them for every
  how-do-I question, which is what puts them into the agent tool catalog. The
  `agent-tools` feature does not have to be mounted.

## Content rules

The text is returned as tool data, not as instructions, and ships to every caller the
`access` admits. Put only public handbook content into it, never tenant or customer data.
