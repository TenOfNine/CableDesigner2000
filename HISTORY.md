# HISTORY.md – long-term memory of CableDesigner2000

This file records requirements, decisions and lessons learned, so that work can continue without the original chat.
Newest entries are appended per version. Conversation with PH (the owner) is in German; this file is in English.

---

## Origin and goals

- PH wants a web-based **cable harness designer for private projects**, modelled on the product video of
  harness.design (schematic with connectors and wires, layout/formboard with segment lengths, lists, exports).
- Requirements from the first request:
  - fully usable through a web UI;
  - multiple user accounts so projects can be separated;
  - sub-projects inside an account;
  - export via print, as an image and as an Excel list;
  - "extensions are planned – start with the basics".
- PH's standing instruction: *be as precise as possible; when something is unclear, ask before deciding* (he may
  have forgotten to provide information).

## v0.1 – "Harness Designer" (initial release, commit 58053b1 on `main`)

### Decisions (answers by PH)

- **Hosting:** self-hosted with Docker.
- **Scope:** schematic **and** layout with automatic length calculation.
- **Library:** a global library plus own parts per account, pre-filled.
- **Accounts:** the administrator creates accounts (no self-registration); projects can be shared between accounts.

### Design

- Node 22 + Express 4 + better-sqlite3; React 19 + Vite + react-router + zustand; plain SVG canvases.
- **Security:**
  - scrypt password hashes;
  - HttpOnly session cookie;
  - CSRF protection via a custom request header;
  - strict CSP;
  - login throttling per IP and user name.
- A harness is one JSON document with a version counter (optimistic locking, HTTP 409 on conflict).
- **Sharing:** sharing a project shares its whole subtree; permissions are read or edit. Admins do not see others'
  projects without a share.
- When a part is assigned, a snapshot of the part data is stored in the harness (library edits do not change
  existing harnesses).
- **Routing:**
  - Dijkstra over layout segments.
  - Wires may pass branch nodes, splices and devices, but never pass through connectors or terminals.
- **Length formula:** path × (1 + allowance %) + 2 × extra per end + extra length; a per-wire fixed length overrides it.
- Mated connectors (e.g. bulkhead E ⇄ C) let circuits be traced across the connection.

### Lessons learned

- **Autosave:** a pure debounce could postpone saving forever while editing continuously. The fix:
  - save at most 0.9 s after the first unsaved change;
  - re-save if changes happened during an in-flight save;
  - save via `fetch(..., { keepalive: true })` on `pagehide`.
- **Inspector updates:** an update callback that returned `false` aborted the store update (the store treats
  `false` as "no change"). Write `upd((x) => { x.foo = v; })` with braces.
- **Printing:** colour swatches were blank until `print-color-adjust: exact` was set.
- **Sandbox build quirk:** better-sqlite3's node-gyp could not download Node headers (HTTP 403 in the sandbox).
  - Locally: `npm_config_nodedir=/opt/node22`.
  - Docker build stage: `ENV npm_config_nodedir=/usr/local`.
- **Shell quirk:** `pkill -f <pattern>` / `grep` patterns matching their own shell killed the tool shell (exit 144).
  Use `pgrep -f "^node server/index.js"` to find the server.
- **Playwright tests:**
  - Clicking the modal title instead of the button → select `.modal button.primary`.
  - `text=Gespeichert` also matched "Ungespeichert" → use an exact match.
- **Git:** commits are authored as `TenOfNine <TenOfNine@users.noreply.github.com>` to avoid exposing PH's private
  e-mail address. PH granted the GitHub permissions for `TenOfNine/CableDesigner2000` during the first push.

---

## v0.2 – CableDesigner2000 (developed on `feature/v0.2`, merged into `main` on 2026-10-02 at PH's request)

### Request (PH)

- Rename the project consistently to **CableDesigner2000**.
- Add `CLAUDE.md` (rules) and `HISTORY.md` (this file, long-term memory). The repository is English, the chat stays
  German.
- Extensions:
  1. multi-core cables (sheathed cables) and twisted pairs as objects of their own;
  2. embedded sub-harnesses ("Embed Harness");
  3. formboard print at 1:1 over several pages;
  4. more library parts and CSV import of parts lists;
  5. revision history per harness;
  6. research the connectors used by the most common car makers and offer them in a default library, plus the other
     most common connectors (JST, M12 fieldbus, etc.).

### Decisions (answers by PH)

- **UI language:** bilingual German/English, German is the default, switchable in the account and stored per user.
- **Embedding:** a *linked reference*.
  - The sub-harness appears as a block with its interface connectors.
  - Changes to the original apply automatically.
  - The BOM is available both as an assembly and exploded.
- **Revisions:** automatic (at most every 10 minutes, limited number) **plus** named revisions, with compare and
  restore.
- **Vehicle library:** organised by *cross-manufacturer connector systems* (TE, Bosch, Aptiv/Delphi, Yazaki,
  Sumitomo, Molex, USCAR, OBD-II …), each with the makes that typically use it – not one list per car make.

### Implementation notes

**Rename**
- Package/Docker names are `cabledesigner2000`.
- The database file is now `cabledesigner.db`; the legacy `harness.db` (+ `-wal`/`-shm`) is renamed on start.
- The session cookie is `cd2000_session`; the CSRF header value is `CableDesigner2000`.
- The export format id is `cabledesigner2000`; `harness-designer` is still accepted on import.
- The Docker volume is `cabledesigner2000-data` (fixed `name:`); the README describes how to copy the old
  `<folder>_harness-data` volume.

**i18n**
- English source strings are the keys; `client/src/i18n/de.js` holds the German texts.
- The app re-mounts on language change (`<DialogProvider key={lang}>`).
- The server translates messages with `t(req, msg)` using the `X-Lang` header or the user's language
  (`users.language`, migration 1).
- `node scripts/check-i18n.mjs` checks completeness.

**Cables**
- Stored as `doc.cables` entries: `{ id, label, kind: 'cable' | 'twist', part, type, cores, shield, layLength,
  outerDiameter, excludeFromBom, notes }`.
- Wires reference a cable via `cableId` and `cableRole` (`core` | `shield`).
- Multi-core cables appear in the BOM as cables (in metres); twisted wires stay individual wires, noted "twisted".
- **Twist factor:** √(1 + (π·d / lay length)²), with d ≈ the wire's outer diameter.
- Checks warn when more cores are assigned than the cable has, and when a twisted group does not have 2 wires.

**Sub-harnesses**
- Component type `subharness` with `ref: { harnessId, name }`.
- Virtual interface components get ids `${blockId}::${childComponentId}`.
- The interface is the child components flagged `interface`, or, if none are flagged, all connectors and terminals.
- `GET /harnesses/:id/embeds` loads embeds transitively.
- The server rejects embedding loops on save and on restore.
- A new block is placed to the right of the existing schematic, because its size is unknown before the child is
  loaded.

**Revisions**
- Stored in the table `harness_revisions` (kind `auto` | `named`).
- On save, the *previous* state is stored as an auto revision if the last one is ≥ 10 minutes old; the newest 50 auto
  revisions are kept.
- Restore first stores the current state as a revision.
- Naming an auto revision makes it a permanent named revision.

**Formboard 1:1**
- Each connected segment group is laid out by BFS, scaling the drawn polylines to the real segment lengths; loops
  produce a warning.
- Groups are placed side by side.
- **Tiling:**
  - tiles are the page content area minus a 9 mm header, with 10 mm overlap;
  - empty tiles are skipped;
  - every tile has a 50 mm grid and a 100 mm check scale with 10 mm ticks;
  - an overview page shows the tile grid.
- Example: the demo harness (≈ 3.05 × 1.71 m) needs 35 A4-landscape sheets.

**CSV import**
- The delimiter is detected automatically (`;`, `,` or tab).
- English or German column aliases; `|` separates lists inside a cell.
- Import modes are skip or update; duplicates are matched by category + part number; at most 5000 rows.
- Export uses `;` with a UTF-8 BOM (Excel-friendly).

**Wire seals**
- New part field `sealPart` (single wire seal, e.g. Superseal 281934-2).
- It is counted in the BOM per used cavity, like contacts.
- `lockPart` remains "one per connector".

**Library**
- `SEED_VERSION` 3.
- Seeds carry `data.seedKey`; an upgrade replaces only unmodified seed parts (`created_at = updated_at`, no image).
- `seed-helpers.js` exists because `seed-parts.js` ↔ `seed-vehicle.js` would otherwise import each other in a
  cycle; with ESM that causes a TDZ error for `const` exports.

### Connector research (October 2026)

Research was done from manufacturer and distributor pages; each part stores its main source in `data.url`.
The rule is: no unverified part numbers – a family that could not be verified gets one generic entry (empty part
number, description "Generic: …", note to set the cavity count).

**Vehicle (`server/seed-vehicle.js`, 74 entries)**
- **TE Superseal 1.5:** 1–6 way, both halves (e.g. 282080-1 / 282104-1).
  - Contacts: 282110-1 (socket), 282109-1 (pin).
  - Wire seal: 281934-2.
- **TE MQS:** 1-967644-1 (2-way), 1-967616-1 (6-way); contact 5-965906-1.
- **TE JPT:** 282190-1 / 282191-1 / 282192-1 (2–4 way); contact 929939-1.
- **Bosch Jetronic/EV1:** 1 928 402 405, 1 928 402 571, 1 928 403 490.
- **Bosch Compact:** 1 928 404 213, 1 928 403 966, 1 928 404 073, 1 928 403 110.
- **Aptiv Weather Pack:** 1–4 way, both halves (e.g. 12015792 / 12010973); contacts 12089188 / 12089040.
- **Aptiv Metri-Pack 150:** 12162000, 12162193, 12052641, 12129615, 12110293.
- **Aptiv Metri-Pack 280:** 15300002 / 15300027.
- **Aptiv GT 150 / GT 280:** 13510085, 13519047, 15326822, 15326678.
- **Molex MX150:** 33471-0n01 / 33481-0n01 (2, 3, 4, 6 way); contacts 33012-3001 / 33000-0001.
- **OBD-II (SAE J1962):** Molex 51115-1601; Aptiv 12110250 / 12110252.
- **DEUTSCH:**
  - DTP04-2P / DTP06-2S, DTP04-4P / DTP06-4S (wedgelocks WP-…);
  - HD10-6-12P, HD10-9-1939P / HD16-9-1939S (J1939), HD36-24-21SN.
- **Generic only** (part numbers not verified):
  - TE MCP 1.5K, MCP 2.8, Quadlock;
  - Bosch BDK 2.8;
  - USCAR EV6 injector;
  - Metri-Pack 480;
  - Sumitomo 090 sealed and TS;
  - Yazaki 090 sealed;
  - ISO 10487 (radio), ISO 1724 (7-pin trailer), ISO 11446 (13-pin trailer).
- `usedBy` lists makes that *typically* use a system; it is not OEM-confirmed and not exhaustive.

**Industrial / hobby (`server/seed-industrial.js`, 123 entries)**
- **JST SH, GH, ZH, EH, VH, PA:** 2–8 way receptacle housings with crimp contacts and the matching headers.
- **JST SM:** SMR = pin contacts (male), SMP = sockets (female); socket contact SHF-001T-0.8BS.
- **JST RCY:** SYR-02T = male, SYP-02T-1 = female.
- **Molex:**
  - KK 254: 22-01-30n7, terminal 08-50-0114;
  - Mini-Fit Jr.: 39-01-20n0 / 39-01-20n1, terminals 39-00-0039 / 39-00-0041;
  - PicoBlade: 51021-0n00, terminal 50079-8000.
- **TE MATE-N-LOK:**
  - Universal MATE-N-LOK: 1-48069x-0 / 1-48070x-0; plugs take sockets, caps take pins; contacts 350536-1 / 350218-1.
  - Commercial MATE-N-LOK: 1-480424-0 / 1-480426-0.
- **M12:**
  - A-coded 4/5-pin: Phoenix 1662528/1681127, 1663116/1662968;
  - A-coded 8-pin: binder 99-1487-812-08 / 99-1486-812-08;
  - B-coded: Phoenix 1507764/1507777;
  - D-coded: Phoenix 1543223/1553611;
  - X-coded: Phoenix 1411044/1414587.
- **M8 3/4-pin:** Phoenix 1681156/1681172, 1501265/1681185.
- **Anderson:**
  - Powerpole housings 1327 / 1327G6 (genderless, stored as "female"); contacts 1332 (15 A), 1331 (30 A);
  - SB50: 992 / 992G1, kit 6319G1.
- **AMASS:** XT30U-M/F, XT60-M/F, XT60H-M, XT90S-F.
- **Generic:** Dupont 2.54, XT90 male, EC5, Deans/T-plug, 5.5×2.1 mm DC barrel.
- **Dropped:** loose contact entries (Anderson 1331/1332/5915) – they are contacts, not housings; their numbers are
  in the housings' `contactPart` / notes.

**Open points from the research**
- Some mating parts are missing: MQS, JPT, part of Metri-Pack/GT, and Mini-Fit 39-01-4030.
- Some Molex 3/5/6-way numbers were only seen in search results, not on fetched product pages.
- `te.com` showed "not currently available" for some TE MATE-N-LOK parts.

### Testing done (v0.2)

- Client build OK; i18n check: 0 missing / unused / placeholder mismatches.
- **Browser tests (Playwright, German UI):**
  - import of the example;
  - all tabs;
  - twisted pair and multi-core cable from a library cable (core colours applied, BOM in metres);
  - embedding with mating of a virtual connector; BOM assembly vs. exploded (exploded totals equal the original
    harness);
  - embed loop rejected;
  - named revision + title-block revision, delete, compare, restore;
  - print incl. formboard (PDF: 45 pages A4, 100 mm scale measured correct);
  - Excel (7 sheets);
  - PNG;
  - CSV import (German headers, error rows, ignored columns, update mode, template).
- **English UI:** language switch in the account, editor, lists, library.
- **Migration from a v0.1 database:** `harness.db` renamed, `user_version` 2, v1 seeds replaced, data kept.
- **Environment notes:**
  - The CSP (`script-src 'self'`) blocks Playwright's `wait_for_function` with expression strings – pass a
    function.
  - `window.print` was stubbed in tests and the PDF created with `page.pdf(prefer_css_page_size=True)`.

### After the v0.2 merge

- 2026-10-02: README screenshots added in `docs/screenshots/` (schematic, layout, library). They were taken with
  Playwright at 1440 × 860 in the English UI, using the example harness (`examples/…`) in a project
  "Motorcycle › Engine". Retake them when the UI changes noticeably. `docs/` is excluded from the Docker image.
- 2026-10-02: New app icon chosen by PH from six concepts: **"B – mating face"**, a connector housing with four
  cavities in the wire colours red/orange/green/blue on a dark tile (best legibility at 16 px). It replaces the
  former four diagonal wire stripes in `client/public/favicon.svg`, which is also used as the logo in the header,
  editor and login page. README screenshots were retaken with the new icon.
