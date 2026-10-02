# CLAUDE.md – rules for working on CableDesigner2000

Read this file and `HISTORY.md` before changing anything. `HISTORY.md` is the long-term memory of the project:
decisions, the reasons behind them and lessons learned. Keep it up to date (see "History" below).

## Language

- **Repository content is English:** code, comments, identifiers, commit messages, branch names, README, CLAUDE.md,
  HISTORY.md, example files, server log output.
- **Conversation with the owner (PH) is German.** Answer in German, keep repo artefacts in English.
- **UI texts are bilingual (German default, English).** See "i18n" below – never hard-code user-facing text.

## Working style

- Be as precise as possible. If something is unclear or a decision could reasonably go several ways, **ask PH
  before deciding** – he may simply have forgotten to provide a detail. Do not silently invent requirements.
- Prefer small, well-understood changes over large rewrites; keep the existing architecture (see below).
- Never invent part numbers. Library parts need a verified source (manufacturer or major distributor page, stored in
  `data.url`); if a family cannot be verified, add a clearly marked generic entry (empty part number, description
  starting with "Generic:") instead.
- Verify before claiming: build the client, run the server and test the affected feature in a browser
  (both languages when UI texts changed). Report what was tested and what was not.

## Git workflow

- `main` holds released states. Develop on feature branches (e.g. `feature/v0.2`) and push those; merge into `main`
  only when PH asks for it.
- Commit messages in English, imperative mood, with a short summary line and a body for larger changes.
- Commit author: `TenOfNine <TenOfNine@users.noreply.github.com>` (do not expose a private e-mail address).
- Never commit `data/`, `dist/`, `node_modules/` or database files.

## Architecture (short)

- `server/` – Node 22, Express 4, better-sqlite3. Sessions via HttpOnly cookie `cd2000_session`, scrypt passwords,
  CSRF protection via the custom header `X-Requested-With: CableDesigner2000`, strict CSP (`script-src 'self'`).
  Database `DATA_DIR/cabledesigner.db`; schema migrations in `server/db.js` via `PRAGMA user_version`
  (append to `MIGRATIONS`, never edit an existing migration).
- Harness documents are stored as JSON (`components`, `wires`, `cables`, `nodes`, `segments`, `notes`, `settings`)
  with a `version` column for optimistic locking. The server only validates the structure
  (`server/harness-data.js`); all domain logic lives in the client.
- When the document format changes: bump `SCHEMA_VERSION` in **both** `server/harness-data.js` and
  `client/src/editor/model.js` and upgrade old documents in `normalizeDoc()`.
- `client/` – React 19 + Vite, zustand store with undo/redo (`client/src/editor/store.js`).
  `derive.js` computes everything derived (routing, lengths, circuits, cables, sub-harnesses, BOM, checks) from the
  document; scene components (`SchematicScene`, `LayoutScene`, `formboard.jsx`) are pure SVG renderers reused for
  print and image export. Excel export loads `exceljs` dynamically.
- Built-in library: `server/seed-parts.js` (+ `seed-vehicle.js`, `seed-industrial.js`, helpers in
  `seed-helpers.js`). Every seed part has a stable `data.seedKey`. When seed data changes, bump `SEED_VERSION`;
  the upgrade only replaces seed parts that were not modified by an administrator.

## i18n

- Client: wrap every user-facing string in `t('English source text', { params })` from `client/src/i18n/index.js`.
  The English text is the key; add the German translation to `client/src/i18n/de.js`.
  Placeholders use `{name}` and must match in both languages.
- Server: user-facing error messages go through `t(req, 'English text', params)` from `server/i18n.js`
  (language from the `X-Lang` header or the user's setting); add the German text there.
- Library parts carry English texts plus `descriptionDe`, `notesDe`, `applicationDe`, `color.nameDe`; use the
  helpers `partDescription()`, `partNotes()`, `partApplication()`, `partColorName()` for display.
- After UI text changes, check completeness: extract all `t('…')` keys and compare with `de.js` (missing, unused and
  placeholder mismatches must be zero): `node scripts/check-i18n.mjs`.

## Building and testing

```bash
npm install                      # in a sandbox without internet access to nodejs.org, better-sqlite3 needs
                                 # npm_config_nodedir=<node include dir> (Dockerfile uses /usr/local)
npx vite build                   # client build into dist/
DATA_DIR=/tmp/cd-data PORT=8092 node server/index.js
node scripts/make-example.mjs    # regenerate the example harness after library/format changes
```

- Browser tests: Playwright with the pre-installed Chromium (Python or Node). Because of the CSP, `wait_for_function`
  must be given a function (`"() => …"`), not an expression string.
- Test with a fresh `DATA_DIR` and, for migrations, with a copy of an older database.
- Check the browser console for errors and React warnings during tests.

## Docker

- `docker compose up -d --build`; data lives in the named volume `cabledesigner2000-data` (`/data`).
- The image compiles better-sqlite3 (`ENV npm_config_nodedir=/usr/local` in the build stage).

## History

Append to `HISTORY.md` whenever a decision is made, a requirement is clarified by PH, a non-obvious bug is fixed or
something about the environment is learned. Write it so that a future session without access to the chat can
continue the work.
