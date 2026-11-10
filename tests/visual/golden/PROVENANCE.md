# Golden provenance

Where each golden in this folder came from, its last change, and what reads it now. Goldens are captured once and
not edited to make a test pass; a mismatch is fixed in the app code. `tests/visual/golden-provenance.test.mjs` keeps
one section per golden file.

The v2 goldens (nav-v2.json, pages-v2.json) were captured at the fixed clock the specs set (2026-10-28T00:00:00Z,
en-US, UTC; e8373be).

## store-calls.json

- Captured: f1bc760 (2026-11-06, "capture 0.8.1 parity goldens"), from the 0.8.1 vanilla Desk.
- Last changed: f1bc760. Unchanged since capture; read only.
- Read by: `skills/routineos/assets/desk/test/storecalls.test.jsx` (the store calls the Mantine Desk makes must equal it).

## nav.json

- Captured: f1bc760 (2026-11-06), the 0.8.1 nav.
- Last changed: f1bc760.
- Read by: nothing. Kept as the 0.8.1 reference; the grouped nav is pinned by nav-v2.json.

## pages.json

- Captured: f1bc760 (2026-11-06), the 0.8.1 page text.
- Last changed: f1bc760.
- Read by: nothing. The 0.8.1 text parity was retired in e8373be.

## nav-v2.json

- Captured: dc1f8bc (2026-11-06, grouped nav model).
- Last changed: 96a9e68 (2026-11-08): the Members entry was added by hand when navModel gained it.
- Read by: `skills/routineos/assets/desk/test/storecalls.test.jsx` (the nav model must equal it).

## pages-v2.json

- Captured: e8373be (2026-11-06), keys added per package with `CAPTURE_V2=1` (94fde4d, 95bb9ad, def1718), from the
  vanilla v2 Desk.
- Last changed: 4741c08 (2026-11-08). Keys were recaptured in cb0137d (record head five-pill strip), 0b71b28,
  676d4e6, 9dc11df (uppercase activity headings), ec9217f (run counts line), 1deb06b, 86ee1d3, 60cb45a, 96a9e68
  and 4741c08, each with the vanilla page it describes.
- Read by: nothing on the Mantine Desk. `v2pages.spec.mjs` takes only the routes from `routes-v2.mjs` and checks
  structure (one h1, landmarks, named controls, no horizontal scroll, no busy state); it does not compare the text.
  The Mantine pages render different text (Mantine markup), so this file describes the vanilla Desk and is not a
  regression guard for this build. The record head strip is held by a vitest instead
  (`test/entity.test.jsx`, "the record head shows the health chip, state, type and Last seen").
