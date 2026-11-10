# Desk components

Contents: before writing Desk code, components (core, pages), custom components (new, copy), host checks.

The components the Desk can draw, and what the artifact host is known to allow. The Desk is a React and Mantine
app, prebuilt into one file. The list below is generated from `assets/desk/components/registry.json`.

## Before writing Desk code

- Always run `routineos desk components --routine <dir>` first. It lists what the Desk already has.
- Order of preference: an existing default module, then a view module, then a custom field cell component on a
  view module. Write a custom component only when the default cell text does not serve the field, and say why in
  its manifest.
- A custom component builds plain elements with the `ui` helpers (`ui.button`, `ui.badge` and the rest). It never
  imports React or Mantine.
- `routineos desk lint` checks the registry, that each core `factory` is a `ui` helper, and that the generated block
  below is current. `routineos lint <routine>` checks only that routine's custom components and desk block; it runs
  the full registry lint only inside the plugin repo.

## Components

<!-- generated:start -->
## Core components

### button

A clickable action. One primary per card.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |
| `primary` | bool | no |
| `icon` | icon | no |
| `iconOnly` | bool | no |
| `pressed` | bool | no |
| `disabled` | bool | no |
| `title` | text | no |

Accessibility: Icon-only buttons need title; it becomes the label and the tooltip.

Use: `ui.button(...)` in a custom component; it builds a plain element.

### badge

A short status label. Green only for ok.

| Prop | Type | Required |
|---|---|---|
| `text` | text | yes |
| `tone` | choice: ok, warn, fail, pur, accent, neutral | no |

Accessibility: The text carries the meaning; the tone colour only repeats it.

Use: `ui.badge(...)` in a custom component; it builds a plain element.

### agent-badge

Marks a record or view that a routine made, with the producer's label.

| Prop | Type | Required |
|---|---|---|
| `producerLabel` | text | no |

Use: `ui.agentBadge(...)` in a custom component; it builds a plain element.

### chip

A toggle filter or tag a person can press.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |
| `pressed` | bool | no |

Accessibility: The pressed state is exposed with aria-pressed.

Use: `ui.chip(...)` in a custom component; it builds a plain element.

### tag

A read-only tag; a tone for status, or a hue picked from its text for values.

| Prop | Type | Required |
|---|---|---|
| `text` | text | yes |
| `tone` | choice: success, warning, danger, neutral | no |
| `hue` | bool | no |

Accessibility: The text is the label; colour never carries meaning alone.

Use: the Desk draws it on its pages; a custom component cannot call it.

### card

A plain bordered box that groups related content.

| Prop | Type | Required |
|---|---|---|
| `class` | text | no |

Accessibility: No role of its own; the content inside carries the headings.

Use: the Desk draws it on its pages; a custom component cannot call it.

### section-card

A titled section that opens and closes and remembers that per viewer.

| Prop | Type | Required |
|---|---|---|
| `id` | text | yes |
| `title` | text | yes |
| `count` | int | no |
| `open` | bool | no |
| `level` | choice: 2, 3 | no |

Accessibility: The title is a real h2 or h3 inside the summary, so the section shows in the heading outline.

Use: the Desk draws it on its pages; a custom component cannot call it.

### page-header

The page title, an optional subtitle and the page's actions.

| Prop | Type | Required |
|---|---|---|
| `title` | text | yes |
| `subtitle` | text | no |

Accessibility: Holds the page's only h1.

Use: the Desk draws it on its pages; a custom component cannot call it.

### settings-nav

The Settings sub-nav: sections in Account and Workspace groups, the current one marked.

| Prop | Type | Required |
|---|---|---|
| `current` | text | yes |

Accessibility: A nav named Settings sections; each group is a labelled list and the current link carries aria-current.

Use: the Desk draws it on its pages; a custom component cannot call it.

### stat-tile

One number with its label and change, linking to the list behind it.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |
| `value` | text | yes |
| `delta` | int | no |
| `href` | text | no |

Accessibility: The label and value read as one link when href is set.

Use: the Desk draws it on its pages; a custom component cannot call it.

### meter

A stacked bar of counts by status.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |

Accessibility: role img with an aria-label that reads every segment's count and label.

Use: the Desk draws it on its pages; a custom component cannot call it.

### details-list

Label and value rows; the first eight show, the rest behind Show all values.

| Prop | Type | Required |
|---|---|---|
| `visible` | int | no |

Accessibility: A description list; an empty value reads Empty.

Use: the Desk draws it on its pages; a custom component cannot call it.

### status-strip

A row of status tags under a record's title.

No props.

Accessibility: Each tag's text carries its meaning.

Use: the Desk draws it on its pages; a custom component cannot call it.

### breadcrumb

The path back from a record to its list.

No props.

Accessibility: A Breadcrumb landmark; the last item has aria-current page.

Use: the Desk draws it on its pages; a custom component cannot call it.

### time

A moment as a human date in the viewer's locale and zone, with the exact time on hover.

| Prop | Type | Required |
|---|---|---|
| `iso` | text | yes |
| `style` | choice: list, sentence | no |
| `now` | int | no |

Accessibility: A time element whose datetime holds the ISO value and whose title gives the exact moment.

Use: the Desk draws it on its pages; a custom component cannot call it.

### format-number

A number in the viewer's locale.

| Prop | Type | Required |
|---|---|---|
| `n` | int | yes |
| `opts` | ref | no |

Accessibility: Plain text; the number reads as the locale writes it.

Use: the Desk draws it on its pages; a custom component cannot call it.

### person

An avatar with initials and the person's name; Someone, (you) or Read only when that applies.

| Prop | Type | Required |
|---|---|---|
| `id` | text | no |
| `profiles` | ref | yes |
| `viewer` | text | no |
| `size` | choice: s, m | no |

Accessibility: The avatar is hidden from assistive tech; the name beside it is the label.

Use: the Desk draws it on its pages; a custom component cannot call it.

### timeline-row

One event: an icon, a sentence, its time and an optional detail.

| Prop | Type | Required |
|---|---|---|
| `icon` | icon | yes |
| `parts` | ref | yes |
| `at` | text | yes |
| `detail` | ref | no |
| `href` | text | no |

Accessibility: The icon is decorative; the sentence is a link or button when the event opens.

Use: the Desk draws it on its pages; a custom component cannot call it.

### timeline

Events grouped under Today, Yesterday, This week, a month or a year, newest first.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |

Accessibility: An ordered list with an aria-label; each group has an h3 heading.

Use: the Desk draws it on its pages; a custom component cannot call it.

### toast

A short message at the bottom end, with Undo when the action can be reversed.

| Prop | Type | Required |
|---|---|---|
| `message` | text | yes |
| `tone` | choice: success, danger, neutral | no |
| `undoLabel` | text | no |

Accessibility: A polite live region; danger toasts are alerts and stay until closed; hover or focus pauses the timer.

Use: the Desk draws it on its pages; a custom component cannot call it.

### confirm-dialog

A yes or no question before a change, with an optional word to type first.

| Prop | Type | Required |
|---|---|---|
| `title` | text | yes |
| `body` | text | no |
| `confirmLabel` | text | yes |
| `danger` | bool | no |
| `typeToConfirm` | text | no |

Accessibility: A modal dialog; focus returns to the control that opened it.

Use: the Desk draws it on its pages; a custom component cannot call it.

### popover

Extra detail beside a trigger, shown on demand.

| Prop | Type | Required |
|---|---|---|
| `label` | text | no |

Accessibility: The trigger is a button or summary; Esc closes it.

Use: the Desk draws it on its pages; a custom component cannot call it.

### peek

A side panel over the page for a record or a form; full screen on a phone.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |
| `placement` | choice: end, start | yes |
| `width` | int | no |

Accessibility: A labelled modal dialog with a Close button; Esc closes it.

Use: the Desk draws it on its pages; a custom component cannot call it.

### offline-banner

Says the connection is down and what still works.

| Prop | Type | Required |
|---|---|---|
| `reason` | text | yes |

Accessibility: A status region, so the change is announced once.

Use: the Desk draws it on its pages; a custom component cannot call it.

### table

A data table of records, one row each.

| Prop | Type | Required |
|---|---|---|
| `columns` | text | yes |
| `rows` | text | yes |

Accessibility: Header cells carry scope col.

Use: the Desk draws it on its pages; a custom component cannot call it.

### rows

Stacked phone rows: the first field is the title, the rest sit under it.

| Prop | Type | Required |
|---|---|---|
| `items` | text | yes |
| `fields` | text | yes |

Use: the Desk draws it on its pages; a custom component cannot call it.

### input

A text or search field.

| Prop | Type | Required |
|---|---|---|
| `type` | text | no |
| `placeholder` | text | no |
| `aria-label` | text | no |

Accessibility: Give every field a label or aria-label.

Use: the Desk draws it on its pages; a custom component cannot call it.

### select

A single choice from a list.

| Prop | Type | Required |
|---|---|---|
| `options` | text | yes |
| `value` | text | no |

Accessibility: Give every select a label or aria-label.

Use: the Desk draws it on its pages; a custom component cannot call it.

### checkbox

A checkbox with its label.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |
| `checked` | bool | no |

Use: the Desk draws it on its pages; a custom component cannot call it.

### switch

An on or off setting.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |
| `checked` | bool | no |

Accessibility: An input with role switch, named by its label.

Use: the Desk draws it on its pages; a custom component cannot call it.

### drawer

A panel that slides in from an edge.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |
| `placement` | choice: start, end | no |

Accessibility: Labelled by its label; Esc closes it.

Use: the Desk draws it on its pages; a custom component cannot call it.

### dialog

A modal dialog.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |

Accessibility: Labelled by its label; Esc closes it.

Use: the Desk draws it on its pages; a custom component cannot call it.

### dropdown

A menu of actions behind a trigger button.

| Prop | Type | Required |
|---|---|---|
| `trigger` | text | yes |
| `items` | text | yes |

Use: the Desk draws it on its pages; a custom component cannot call it.

### skeleton

A loading placeholder bar.

No props.

Accessibility: Hidden from assistive technology.

Use: the Desk draws it on its pages; a custom component cannot call it.

### callout

A boxed message: neutral for empty, danger for errors.

| Prop | Type | Required |
|---|---|---|
| `variant` | choice: neutral, danger, warning, success, brand | no |

Accessibility: Announced as a status.

Use: the Desk draws it on its pages; a custom component cannot call it.

### details

A block that opens to show more, such as evidence.

| Prop | Type | Required |
|---|---|---|
| `summary` | text | yes |

Use: the Desk draws it on its pages; a custom component cannot call it.

### tab-group

Tabs over panels, each tab with an optional count; one panel shows at a time.

| Prop | Type | Required |
|---|---|---|
| `tabs` | text | yes |
| `active` | text | no |

Accessibility: A tablist of buttons with aria-selected; arrow keys, Home and End move between tabs.

Use: the Desk draws it on its pages; a custom component cannot call it.

### tooltip

A hint shown on hover or focus of another element.

| Prop | Type | Required |
|---|---|---|
| `for` | text | yes |
| `text` | text | yes |

Accessibility: Shown on hover or focus; the target keeps its own label.

Use: the Desk draws it on its pages; a custom component cannot call it.

### icon

A Desk icon by name.

| Prop | Type | Required |
|---|---|---|
| `name` | icon | yes |
| `label` | text | no |

Accessibility: Decorative without a label.

Use: the Desk draws it on its pages; a custom component cannot call it.

### empty-state

The empty state for a page or list.

| Prop | Type | Required |
|---|---|---|
| `kind` | text | yes |

Use: the Desk draws it on its pages; a custom component cannot call it.

### error-state

A read error with a way to try again.

| Prop | Type | Required |
|---|---|---|
| `kind` | text | yes |

Use: the Desk draws it on its pages; a custom component cannot call it.

### loading-state

Placeholder rows while the workspace loads.

No props.

Use: the Desk draws it on its pages; a custom component cannot call it.

### filter-bar

A row of filter chips.

No props.

Accessibility: A labelled group.

Use: the Desk draws it on its pages; a custom component cannot call it.

### pager

Loads the next page of rows.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |

Use: the Desk draws it on its pages; a custom component cannot call it.

### textarea

A multi-line text field with a label.

| Prop | Type | Required |
|---|---|---|
| `label` | text | yes |
| `name` | text | no |
| `rows` | int | no |

Accessibility: The label names the field.

Use: the Desk draws it on its pages; a custom component cannot call it.

### copy-button

Copies a value to the clipboard and says Copied.

| Prop | Type | Required |
|---|---|---|
| `value` | text | yes |
| `label` | text | yes |

Accessibility: The label names the button; the result is announced by the copy button or a toast.

Use: the Desk draws it on its pages; a custom component cannot call it.

### segmented

One choice from a few, drawn as joined buttons.

| Prop | Type | Required |
|---|---|---|
| `name` | text | yes |
| `value` | text | yes |

Accessibility: A radio group named by its label or legend; arrow keys move between choices.

Use: the Desk draws it on its pages; a custom component cannot call it.

### pagination

Moves between pages of a long list.

| Prop | Type | Required |
|---|---|---|
| `page` | int | yes |
| `pages` | int | yes |

Accessibility: A nav named Pagination; Previous and Next are disabled at the ends.

Use: the Desk draws it on its pages; a custom component cannot call it.

### comment-thread

A record's comments, oldest first, with a composer; edit and delete on your own for 15 minutes.

| Prop | Type | Required |
|---|---|---|
| `viewer` | text | no |

Accessibility: Each comment names its author and time; the composer is a labelled textarea, and Cmd or Ctrl Enter posts.

Use: the Desk draws it on its pages; a custom component cannot call it.

### image-notes

Numbered marks over a captured page image, then the notes as a numbered list.

| Prop | Type | Required |
|---|---|---|
| `showNotes` | bool | no |

Accessibility: The number, not the colour, ties a mark to its note; the image has alt text and the notes are a list.

Use: the Desk draws it on its pages; a custom component cannot call it.

## Pages

### today

What needs the viewer now. One primary action per item.

No props.

Use: the `today` default module. Place it with modules; never call it from a component.

### approvals

Every request waiting on a person, by kind, in Waiting, Queued and Done: decide, add a note or undo.

No props.

Use: the `approvals` default module. Place it with modules; never call it from a component.

### workers

One row per lane on the Desk's join card. Shown only when a join card exists.

No props.

Use: the `workers` default module. Place it with modules; never call it from a component.

### runs

Run health: next run, captured items, partial and late runs, and every run by producer, with a peek.

No props.

Use: the `runs` default module. Place it with modules; never call it from a component.

### history

One timeline of runs, decisions, settings changes, comments, merges and views, with a run calendar.

No props.

Use: the `history` default module. Place it with modules; never call it from a component.

### settings

Per-producer settings, workspace choices and About. Settings are human-owned.

No props.

Use: the `settings` default module. Place it with modules; never call it from a component.

### browse

One list per entity type, with filters in the link so back and shared links work.

| Prop | Type | Required |
|---|---|---|
| `type` | ref | yes |

Use: the `browse` default module. Place it with modules; never call it from a component.

### spec

A page declared in the definition (desk.pages): tiles, charts, tables and text with Refresh, date range and a filter.

| Prop | Type | Required |
|---|---|---|
| `id` | text | yes |

Use: the `spec` default module. Place it with modules; never call it from a component.

### entity

One record: fields, per source values, sighting history, links, notes and hand merge.

| Prop | Type | Required |
|---|---|---|
| `type` | ref | yes |
| `key` | text | yes |

Use: the `entity` default module. Place it with modules; never call it from a component.
<!-- generated:end -->

## Custom components

A custom component draws one field cell on a view module, in the `field-cell` slot. It lives in the routine, at
`desk/components/<id>/`, as `component.json` and `<id>.js`.

### desk component new

`routineos desk component new <id> --routine <dir>` scaffolds `<dir>/desk/components/<id>/` with a
`component.json` manifest and a stub `<id>.js` that defines one function, `component_<id>` (hyphens become
underscores). The id is lowercase letters, digits and hyphens. It refuses a core component id and refuses to
overwrite a folder that exists.

Then:

1. Write `why` in `component.json`: at least 40 characters on why the default cell text does not serve the field.
2. Write the function. It takes `(ctx, props, ui)`, reads `props.value`, `props.record` and `props.field`, and
   returns one element built with `ui.el` and the other `ui` factories. `ui.el` takes plain text tags only, keeps only
   the attributes `class`, `title`, `href`, `datetime`, `value`, `lang`, `dir`, `aria-*` and `data-*` (refusing
   any other), and accepts `href` only through `ui.urlOrText`. No string URLs, no event handlers, no names from this routine. Keep every statement inside the function: the
   file holds that one function and nothing else at the top level. The lint also refuses the names `constructor`,
   `Reflect`, `navigator`, `location`, `document`, `globalThis`, `window`, `Function`, `eval` and `importScripts`,
   and, when `node` is on PATH, checks that the file parses. The lint guards against mistakes; it is not a sandbox.
3. Map the field to it on a view module: `"fields": {"<field>": "<id>"}` in the module in `definition.json`.
4. Run `routineos desk lint --routine <dir>`, then `routineos bundle --routine <dir>` to write
   `<dir>/dashboard/index.html` with the component.

If the function throws or returns no element, the Desk draws the default cell text. Each component is bundled in
its own script, apart from the Desk's own code: one that fails to parse is left out, and its fields draw the
default cell text too.

### desk component copy

`routineos desk component copy <id> --from <dir> --to <dir>` copies `desk/components/<id>/` from one routine to
another, then lints the target. It refuses to overwrite a folder that exists. On a lint failure it prints each
problem and exits 1, with the copy left in place to fix. Map the field in the target's view module as for a new
component.

## Desk extensions: record sections, panels and pages

Beyond a field cell, an agent can write three more kinds of component. They live in the same place,
`desk/components/<id>/` (`component.json` and `<id>.js`), and differ by the `slot` in the manifest. Their function is
`component_<id>(ctx, props, ui)` as before.

| slot | draws | extra manifest keys | `props` |
| --- | --- | --- | --- |
| `record-section` | a card on the record page (see `placement`) | `types` (required, entity type ids), `title`, `verbs`, `placement`, `prefs` | `{type, id, record}` |
| `panel` | a card on Today | `view` (required, `{type, filters}`), `title`, `verbs`, `prefs` | `{view, records}`, at most 50; read once, call `ctx.watch` to follow changes |
| `page` | its own page at `#/x/<id>` | `title` (required), `nav` (true adds a sidebar entry), `verbs`, `prefs` | `{args, params}` |

`placement` (record sections only) is `top`, `after-summary` (the default, where sections always drew) or
`after-fields`. `top` draws above Summary; `after-fields` draws below the Decision card. At most one section per
record type may use `top`; `routineos lint` fails a second. [verified: lint and Desk tests in this repo]

`prefs: true` gives the component `ctx.pref(key, fallback)` and `ctx.setPref(key, value)`, a setting the viewer keeps
in this browser under `routineos-ext:<id>:<key>`. A key is 1 to 40 of `a-z`, `0-9`, `-`; a value is text of at most
200 characters (longer throws). A blocked browser store reads as the fallback. The read-only demo returns the fallback
and keeps nothing. It is never a database write and a component cannot name another component's keys. Without
`prefs: true` neither function exists and the lint fails any use. The permission screen says "remembers a setting in
this browser" for such a component. [verified: Desk tests in this repo; that a browser may clear localStorage is
assumed]

A page also needs `[desk] pages = true` in the routine's `routine.toml`; without it the lint fails. Nothing here
edits `routine.toml` for you.

### What a component can do

- Read: `ctx.read(id)`, `ctx.list(view)` (a saved-view shape; a record section or panel gets at most 50 records, a page gets every record the read returned and the array carries `capped: true` when the read stopped at its cap), `ctx.store.get` and
  `ctx.store.list`, and `ctx.watch(collection, cb)` for `entities`, `decisions`, `comments` and `userstate`. `watch`
  returns a disposer; the Desk also calls every disposer when the component leaves the page.
- Draw: everything `ui.el` allows for a field cell, plus `button`, `input`, `textarea`, `label`, `img` (data: and blob: images only; an https source is refused because it would be a request out), `h3`, `h4` and table tags, and the `ui` helpers `button(label, onClick, {local})` (drawn disabled for read-only visits unless `local: true`), `input`, `textarea`,
  `image`, `markdown`, `valueOf(node)` and `status`. No `on*` attribute exists. A click handler is only `ui.button`'s second
  argument.
- SVG: `ui.el` also draws `svg`, `g`, `path`, `line`, `polyline`, `rect`, `circle` and `text`, created in the SVG namespace by the host. Allowed attributes: `viewBox`, `width`, `height`, `x`, `y`, `x1`, `y1`, `x2`, `y2`, `cx`, `cy`, `r`, `d`, `points`, `fill`, `stroke`, `stroke-width`, `stroke-dasharray`, `text-anchor`, `transform`, `role`, `class`, `title` and `aria-*`. Refused, in `ui.el` and again in the host's tree check: `foreignObject`, `use`, `image`, `script`, `style` and the animation tags, any `href` or `xlink:href`, a `style` attribute, any `on*` attribute, and a paint value that contains `url(`. Give a chart an `aria-label` or a `text` summary and a table form; colour alone is not enough. [verified: Desk tests in this repo; how every browser treats SVG in the artifact viewer is unverified]
- Blocks: `ui.block(spec, records)` returns a `div` that the host fills with a spec page block (`tile`, `chart`, `table` or `text`, see [desk-pages.md](desk-pages.md)) drawn from records already read, for example the array from `ctx.list`. A tile shows the same value text as the same spec on a spec page. An unknown kind or a spec that cannot be drawn shows nothing. The host does not look inside the block's own element when it re-checks the tree, so keep the `div` ui.block returns as it is and do not add children to it. [verified: Desk tests in this repo]
- Size: a component file larger than 64 KiB fails the lint; past that, use a spec page.
- Upgrade note: widening the host does not change a component's approval hash, so a code page approved earlier gains SVG, `ui.block` and the uncapped page `ctx.list` when the Desk is rebuilt, with no new approval. The owner who approved the code approved what it could do on the older host; read it again if that matters. The lint is a text check and approval is enforced only by the Python publisher.
- Markdown: `ui.markdown(text, {marks, clamp, onlyMarked})` returns one `div` built from the text as Markdown. Headings
  become `h3` (levels 1 to 3) or `h4` (deeper); bold, italic, code, lists, quotes and tables become their elements. Raw
  HTML in the text is shown as text, an image is its alt text, and only an `https` link is live (any other link is its
  text). `marks` is a list of phrases to highlight, matched without regard to case, wrapped in `mark` inside a single
  run of text (a phrase that spans bold and plain text is not marked). `onlyMarked: true` keeps only the paragraphs,
  headings, list items, quotes and tables that hold a mark (with no `marks` it shows nothing). `clamp: n` keeps the first n top-level blocks. Use it
  instead of stripping Markdown markers by hand; it adds no tag or attribute to the allow-list. The lint's `on*` key check lets the exact key `onlyMarked` through and still refuses any other `on` key.
- Write: only through `ctx.actions`, and only the verbs the manifest lists in `verbs`. A verb that is not listed does
  not exist on the object the component receives.

| verb | writes | notes |
| --- | --- | --- |
| `decide(id, value, note)` | `decisions/<id>~x` | `value` is 1 to 40 of `a-z`, `0-9`, `-`; `drop` and `keep` are reserved. It never changes the built-in keep or drop decision. |
| `comment(id, text)` | `people/<viewer>/comments/<id>--<ts36>` | text up to 4000 characters; the path names the author |
| `saveField(id, field, value)` | `userstate/<id>` (`fields.<field>`) | value up to 2000 characters |
| `drop(id, reason)` | the built-in drop | same as the Drop action |
| `keep(id)` | the built-in keep | same as the Keep action |
| `request(kind, {routine, note})` | `requests/req~<time>~<random>` | `kind` is `run-now` or `retry`; `routine` must be listed on the Desk. Queued, read at the routine's next scheduled run; it needs no record id. |

Every verb except `request` needs an existing record; a section or panel may act only on the record types its manifest names. A page may act on any record. `drop`, `keep` and `decide` follow the same owner rule as the built-in controls on a joined Desk. `decide`, `comment`, `saveField`, `drop` and `keep` write documents every member of the Desk sees.

Each verb returns a Promise and rejects with the Desk's own message when the visit is read-only, there is no signed-in
viewer, the id is not a record id, or the write path is not on the Desk's write list. Every write goes through
`actions.save` and the same path allowlist as the rest of the Desk. `request` (calling out to the network) is not offered.

### What the lint checks

The lint keeps the code to the declared verbs: every use of `ctx.actions` must be `ctx.actions.<verb>(` with the verb
in `verbs`; `ctx[...]`, an alias of `ctx` or `ctx.actions`, destructuring `ctx`, and a first parameter not named `ctx`
all fail. `ctx.store` offers `get` and `list` only. The other component rules (banned names, no URLs, parse check)
apply too.

This is a guard against mistakes, not containment. A component is code that runs in the Desk page with the owner's
rights. The Desk hands a well-behaved component only the verbs it declares; code written to evade a text lint can
reach more, including the raw store. So the owner approves the code itself, not only the verb list. The permission
screen (`routineos permissions <dir>`) is built from the manifest after the same lint as `desk lint`, marks a failing
component INVALID, and labels its "reads" line as a text scan that is advisory only. A real boundary would render
extensions in a sandboxed iframe; that is not built.

### desk scaffold

`routineos desk scaffold <section|panel|page> <name> --routine <dir> [--type <entity type>]` writes a manifest with an
empty `why` (the lint fails until you write one, 40 or more characters) and a stub function.

### desk preview

`routineos desk preview --routine <dir> [--snapshot FILE] [--out DIR]` lints, then writes a static copy of the Desk
with the routine's components over demo data (default `<dir>/demo/desk-demo.json`). It is read-only: a verb shows
the Desk's read-only message and saves nothing, and it shows the demo snapshot, not live data. Serve the folder with
`python3 -m http.server --directory <out>`.

## Host checks

- The Desk is one HTML file. Vite inlines React, Mantine, the app code and its styles; the page makes no network
  request of its own, and only the store reaches the host (`window.claude`).
- React and Mantine in the artifact viewer: `assets/desk/probe/` checks that Mantine mounts, that a click can save
  a file, and that the clipboard works. The owner's check in the viewer is pending.
- A custom component's `component.json` may still carry a `wa` list from an older Desk. It is accepted and ignored.

## Approval is tied to the code

A record section, panel or page is built into the Desk only when its current code matches what the owner approved. `routineos permissions <dir>` prints the permission screen, including a short hash of each component. `routineos permissions <dir> --approve` records the full hash of every component's manifest and code in `desk/approvals.json`; it refuses while any component is INVALID. Editing a component after that makes the Desk build refuse it until it is approved again. `--approve` is the owner's act: an agent must not run it for them.
