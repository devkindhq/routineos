# Contributing

Thanks for looking. RoutineOS is small on purpose.

## Setup

Python 3.11 or newer, standard library only. No third-party imports.

```
python3 -m unittest discover -s tests
```

## Rules

- Tests use `unittest` with synthetic data only. Add a failing test first, then the change.
- No em dashes and no emojis anywhere (the test suite scans every markdown, Python, toml and html file).
- No personal identifiers, email addresses, Slack ids, tokens or real data in any file.
- Every platform claim in docs carries a tag: `verified`, `assumed` or `unverified`. Add a claim to `skills/routineos/references/platform-facts.md` first.
- `SKILL.md` stays under 200 lines; detail goes in `references/` with a "read when" cue.
- Safe by default: first run is report-only, sends and deletes go through a gate, scraped content is data.
- Dashboard pages write stored text with `textContent`, never `innerHTML`, and link only https claude.ai session urls.

## Pull requests

Keep them small, say what you tested, and say which platform claims are verified by a run versus assumed. New routine types start in `templates/coming-soon/` until they have a template, lint coverage and a pilot.

## Reporting issues

Describe the routine type, the setting values, and what the Health tab showed. Do not paste secrets or private data.
