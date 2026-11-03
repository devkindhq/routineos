# Loop: the RoutineOS design direction

Loop is the chosen brand and homepage direction for routineos.org. A routine goes round a loop, and each time round it gets a little better because a person told it what they wanted.

Open the files in a browser. Both are single HTML pages with no build step; they load only Google Fonts.

| File | What it is |
|---|---|
| `homepage.html` | The light homepage. Plain words for non-technical people first, with a "For technical people" section for the Rails map, the CLI and the linter rules. Has an interactive Desk demo and Claude Desktop / Claude Code install tabs. |
| `brand-board.html` | The Loop brand board: logo variants, the Desk mark, icons, type, colour palette with contrast, the lifecycle graphic and sample uses. |
| `kazim-avatar.jpg` | The small avatar used in the homepage testimonial card. |

## Decisions

- The logo is RoutineOS only. The ring of 8 segments is the O, with a gap at the top where the next run comes back in. The Desk is a product concept with its own mark, never part of the logo.
- Light only.
- The main audience is people who are not technical. Above the technical section the page avoids terms such as cron, linter, CLI, MCP and artifact.
- Install shows two choices: Claude Desktop (add the RoutineOS connector) and Claude Code (install the plugin).
- Navigation follows the shape of framework sites: Templates, How it works, Lifecycle, Compare, Docs, GitHub.

## Type and colour

- Instrument Sans for headings and body, Instrument Serif italic for one or two words, Geist Mono for code.
- Porcelain ground, cobalt as the primary, and 8 stage colours, one per lifecycle stage. Values and contrast ratios are in `brand-board.html`.

## Before launch

- The template blurbs, the FAQ answers and the compare table are written from the README and the catalog. Check them against the docs before publishing.
- The Claude Desktop steps connect the RoutineOS docs and templates. Building and scheduling a routine still uses Claude scheduled tasks.
- The testimonial uses a photo and quotes from Kazim Ali, lightly edited from a team meeting.
