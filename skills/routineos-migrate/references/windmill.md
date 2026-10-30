# Migrate from Windmill

`routineos migrate windmill <flow.json> --out DIR` reads a Windmill flow as OpenFlow JSON. See the [overview](README.md).

OpenFlow is a JSON-serialisable standard for flows as DAGs. The OpenAPI file in the Windmill repository is the source of truth (https://raw.githubusercontent.com/windmill-labs/windmill/main/openflow.openapi.yaml, described at https://www.windmill.dev/docs/openflow). The root has `summary`, an optional `description`, `value` (with `modules`) and an optional `schema` for the flow input.

## Mapping

| OpenFlow | Concept | Becomes |
|---|---|---|
| rawscript | step.code | a code stage; `language` picks the extension and `content` is kept as source |
| script, flow (by path) | step.subworkflow | needs a person; the path is named |
| forloopflow, whileloopflow | step.loop | the inner modules are flattened after it and marked "for each item" |
| branchone, branchall | step.branch | the branches are flattened and marked by branch summary |
| identity | step.noop | dropped, recorded as info |
| aiagent | step.agent | a skill stage; system prompt and user message are used when static |
| aidecision | step.branch | a model stage |
| `suspend` on a module | step.wait-approval | a gate stage after that module (and after its inner modules, for a loop or branch), before the next step. Unverified, see below |
| `failure_module` | failure.workflow | failure handling |
| `schema.properties` | settings | boolean to toggle, number or integer to number, `enum` to choice, string array to list; the rest is reported |
| `$res:path` in a static transform | credential | by path only; a resource name that matches a known app also gets an unverified `mcp` connector, otherwise a `setup` issue |
| `$var:name` in a static transform | credential | by path only, plus a `setup` issue: re-create the value yourself |
| `results.x`, `flow_input.y` in javascript transforms | expression | explicit inputs: "`x` from step `id`", "Setting `y`" |

Resources and variables are referenced with `$res:PATH` and `$var:NAME` placeholders (https://www.windmill.dev/docs/core_concepts/resources_and_types). The converter reads only the path, never a value.

## Suspend and approval

Where the gate goes is **unverified**. The Windmill approval page (https://www.windmill.dev/docs/flows/flow_approval, fetched 2026-10-30) calls an approval step "a normal script with `Suspend until approval/resume` enabled in the step's `Run settings` tab", says to "include the resume url in the returned payload of the step", and says the flow "will not proceed to the next step" until the required approvals arrive. That implies the module runs first and the flow suspends after it, so the converter puts the gate after the module. The page does not say this in so many words. The emitter still moves every write stage after the gate, so a write step is not run before approval in the converted routine.

## Source checks

A number input whose `minimum` is above its `maximum` stops the conversion with a message that names the input, because the flow's own schema is inconsistent. A malformed file that the parser cannot read ends in exit 2 with "this workflow could not be converted" and no traceback.

## Schedule

A flow file carries no schedule: schedules are separate objects and are not synced by default (https://www.windmill.dev/docs/advanced/cli/sync). The default schedule `0 22 * * 1-5` applies, and the emitter reports it as a `needs-person` issue. Ask the person for the real cron, in UTC.

## YAML

`flow.yaml` is refused with a message to export the flow as JSON, because the Python standard library has no YAML parser. A synced flow lives at `<path>__flow/flow.yaml` (same sync page), so a person with a synced repository needs the JSON export. That the Windmill UI exports JSON is unverified.

## Code

`rawscript` content can be TypeScript, Python, Bash and others. It is kept in `lib/source/` and never run. The skill translates it to a Python 3.11 standard library script or replaces it with a model step. See [n8n](n8n.md#code-nodes) for the stub.

## Licence

The GitHub API reported the Windmill licence as NOASSERTION on 2026-10-30 (https://api.github.com/repos/windmill-labs/windmill). The licence text was not read: unverified. Converting your own flow is unaffected.
