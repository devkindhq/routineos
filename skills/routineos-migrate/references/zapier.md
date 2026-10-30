# Migrate from Zapier

There is no Zapier parser. Zapier's export JSON schema is undocumented, and we have not obtained a real sample (Zapier's help article describes the download and upload steps for Team and Enterprise plans but not the contents: https://help.zapier.com/hc/en-us/articles/8496308481933; a July 2026 community request calls the schema "undocumented", https://community.zapier.com/how-do-i-3/feature-request-close-the-json-round-trip-for-zap-editing-53644). So the `routineos-migrate` skill uses a guided path and never invents a schema. See the [overview](README.md).

## The guided path

The skill asks the person for:

1. The trigger: app and event, and how often it fires.
2. The steps in order: app, action and the key fields each uses. Never connection details or keys.
3. Filters, paths (branches and their conditions), delays, and any code or formatter steps.
4. A name for the Zap.

It then writes a `routineos.migration.v1` plan with `source.tool` set to `"zapier"`, adds an `unverified` issue for every app and action name (they come from the person's description, not from Zapier), and runs `migrate steps`. The pack and report follow the same rules as any other conversion: write steps move after an approval gate, the first run is report-only, and credentials are re-created by name by the person.

Concept ids that fit a Zap are listed in the [concept map](concepts.md) (for example `trigger.schedule` for Schedule by Zapier, `trigger.app`, `step.app`, `step.branch` for Filter and Paths, `step.wait-time` for Delay, `step.code`). Delay limits and Paths limits seen on Zapier's community pages are unverified.

## Plan format example

This plan converts with `migrate steps plan.json --out DIR` (it was converted and its pack passed `pack validate` when this page was written):

```json
{
  "format": "routineos.migration.v1",
  "source": {"tool": "zapier", "name": "New lead to Slack and Sheet", "ref": "described by the person"},
  "id": "new-lead-digest",
  "title": "New lead digest",
  "summary": "Collects new form leads, drops the ones without a company, and reports them.",
  "kind": "workflow",
  "trigger": {"concept": "trigger.app", "note": "Zapier trigger: New Lead in a form app. Polled hourly here."},
  "steps": [
    {"id": "read-leads", "concept": "step.app", "title": "Read new leads", "does": "Reads new leads from the form app.",
     "app": "typeform", "access": "read", "op": "getAll", "source": "Trigger: New Entry"},
    {"id": "skip-no-company", "concept": "step.branch", "title": "Skip leads without a company",
     "does": "Drops a lead when its company field is empty.", "inputs": ["`company` from step `read-leads`"],
     "source": "Filter by Zapier"},
    {"id": "post-summary", "concept": "step.app", "title": "Post a summary", "does": "Posts the lead summary to a channel.",
     "app": "slack", "access": "write", "op": "post", "source": "Slack: Send Channel Message"}
  ],
  "issues": [{"level": "unverified", "concept": "step.app", "where": "read-leads",
              "message": "The Typeform app and action names were described by the person and are not checked against Zapier."}]
}
```

Fields:

- `source.tool` is `n8n`, `windmill` or `zapier`. `source.untrusted` marks text from a third party. `migrate steps` sets it to true unless `--trusted` is passed.
- `trigger.concept` is `trigger.schedule`, `trigger.app` or another trigger concept. `trigger.cron` is UTC and at most hourly.
- Each step has an `id`, a `concept` from `migrate concepts`, a `title` and `does`. App steps add `app` (an id from the app catalog), `access` (`read` or `write`) and `op`. An unknown or missing `op` counts as a write.
- `inputs` names what a step reads, as "`field` from step `id`".
- `issues[].level` is `unmapped`, `needs-person`, `setup`, `unverified` or `info`. Only `unmapped` and `needs-person` make `migrate steps` exit 1; `setup` is for credentials to re-create.
- `migrate.validate_plan` rejects unknown keys. `migrate steps` refuses a plan with problems and prints each one.
