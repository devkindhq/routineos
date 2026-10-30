# Migrate: concept map

The data behind `routineos migrate` is `skills/routineos/registry/migrate-concepts.json` (format `routineos.migrate-concepts.v1`). This page lists every concept and app in it. A test keeps the two in step.

## How a node type is matched

A parser looks a node type up with `migrate.lookup(node_type, tool)`. The tool is `n8n`, `windmill` or `zapier`. Matching is exact first. If nothing matches exactly, the longest entry that ends in `*` and is a prefix of the node type wins. For example `lmChat*` matches every chat-model sub-node. A node type that matches nothing is `step.unknown`. The map is lookup-only, so a wrong node name never matches anything and never breaks a conversion.

## Status

- `mapped`: RoutineOS has a direct equivalent.
- `partial`: it converts, with a stated difference.
- `needs-person`: it converts to a placeholder that a person must finish.
- `unmapped`: reported, with no equivalent.

Every concept with a status other than `mapped` produces an issue in the migration report when it is met.

## Concepts

| Id | Status | RoutineOS target | n8n | Windmill | Zapier |
|---|---|---|---|---|---|
| `trigger.schedule` | mapped | routine schedule (cron, UTC, at most hourly) | `n8n-nodes-base.scheduleTrigger`, `n8n-nodes-base.cron` | none | `Schedule by Zapier` |
| `trigger.webhook` | needs-person | default schedule plus the Desk action queue (requests/); inbound webhooks are unverified on the platform | `n8n-nodes-base.webhook`, `@n8n/n8n-nodes-langchain.mcpTrigger` | none | `Webhooks by Zapier` |
| `trigger.manual` | partial | default schedule; run from the Desk queue | `n8n-nodes-base.manualTrigger` | none | none |
| `trigger.chat` | needs-person | default schedule; chat entry has no RoutineOS equivalent | `@n8n/n8n-nodes-langchain.chatTrigger`, `@n8n/n8n-nodes-langchain.manualChatTrigger` | none | none |
| `trigger.form` | needs-person | default schedule plus Desk queue | `n8n-nodes-base.formTrigger` | none | none |
| `trigger.app` | partial | scheduled poll with a read connector | `n8n-nodes-base.emailReadImap`, `n8n-nodes-base.rssFeedReadTrigger` | none | none |
| `trigger.subworkflow` | needs-person | the child is its own routine or folded in by hand | `n8n-nodes-base.executeWorkflowTrigger` | none | none |
| `trigger.error` | mapped | failure handling (alert Inbox message, run status partial or failed) | `n8n-nodes-base.errorTrigger` | none | none |
| `step.app` | partial | a model stage using a connector (read or write) | none | none | none |
| `step.http` | partial | a model stage using an http connector; headers and auth never copied | `n8n-nodes-base.httpRequest`, `n8n-nodes-base.httpRequestTool` | none | none |
| `step.code` | needs-person | a code stage with a stub lib/<id>.py and the original source kept beside it | `n8n-nodes-base.code`, `n8n-nodes-base.function`, `n8n-nodes-base.functionItem` | `rawscript` | `Code by Zapier` |
| `step.agent` | partial | a skill stage with a generated skills/<id>/SKILL.md | `@n8n/n8n-nodes-langchain.agent`, `@n8n/n8n-nodes-langchain.agentTool`, `@n8n/n8n-nodes-langchain.openAiAssistant` | `aiagent` | none |
| `step.llm` | partial | a skill stage (chains, extractors, classifiers, summarisers) | `@n8n/n8n-nodes-langchain.chainLlm`, `@n8n/n8n-nodes-langchain.chainSummarization`, `@n8n/n8n-nodes-langchain.chainRetrievalQa`, `@n8n/n8n-nodes-langchain.informationExtractor`, `@n8n/n8n-nodes-langchain.textClassifier`, `@n8n/n8n-nodes-langchain.sentimentAnalysis`, `@n8n/n8n-nodes-langchain.openAi`, `n8n-nodes-base.openAi` | none | `AI by Zapier` |
| `step.ai-model` | mapped | the model is Claude; the provider is recorded | `@n8n/n8n-nodes-langchain.lmChat*`, `@n8n/n8n-nodes-langchain.lmOpenAi`, `@n8n/n8n-nodes-langchain.lmCohere`, `@n8n/n8n-nodes-langchain.lmOllama`, `@n8n/n8n-nodes-langchain.lmOpenHuggingFaceInference` | none | none |
| `step.ai-memory` | partial | a store collection memory/<id> | `@n8n/n8n-nodes-langchain.memory*` | none | none |
| `step.ai-tool` | partial | a connector on the owning skill stage | `@n8n/n8n-nodes-langchain.tool*`, `@n8n/n8n-nodes-langchain.mcpClientTool` | none | none |
| `step.ai-output-parser` | partial | output shape described in the skill | `@n8n/n8n-nodes-langchain.outputParser*` | none | none |
| `step.ai-vector` | unmapped | reported; no vector store in RoutineOS | `@n8n/n8n-nodes-langchain.vectorStore*`, `@n8n/n8n-nodes-langchain.embeddings*`, `@n8n/n8n-nodes-langchain.documentDefaultDataLoader`, `@n8n/n8n-nodes-langchain.textSplitter*`, `@n8n/n8n-nodes-langchain.retriever*`, `@n8n/n8n-nodes-langchain.toolVectorStore` | none | none |
| `step.branch` | mapped | a model stage that states the condition (IF, Switch, Filter) | `n8n-nodes-base.if`, `n8n-nodes-base.switch`, `n8n-nodes-base.filter` | `branchone`, `branchall`, `aidecision` | `Filter by Zapier`, `Paths by Zapier` |
| `step.merge` | mapped | a model stage that states how inputs combine | `n8n-nodes-base.merge` | none | none |
| `step.loop` | mapped | a model stage that runs the body for each item | `n8n-nodes-base.splitInBatches` | `forloopflow`, `whileloopflow` | `Looping by Zapier` |
| `step.transform` | mapped | a model stage (Set, Aggregate, Split Out, Sort, Limit, Rename) | `n8n-nodes-base.set`, `n8n-nodes-base.aggregate`, `n8n-nodes-base.splitOut`, `n8n-nodes-base.sort`, `n8n-nodes-base.limit`, `n8n-nodes-base.renameKeys`, `n8n-nodes-base.itemLists`, `n8n-nodes-base.summarize`, `n8n-nodes-base.removeDuplicates`, `n8n-nodes-base.dateTime`, `n8n-nodes-base.extractFromFile`, `n8n-nodes-base.convertToFile`, `n8n-nodes-base.html`, `n8n-nodes-base.markdown`, `n8n-nodes-base.xml`, `n8n-nodes-base.crypto`, `n8n-nodes-base.compression`, `n8n-nodes-base.editImage`, `n8n-nodes-base.readBinaryFile`, `n8n-nodes-base.spreadsheetFile`, `n8n-nodes-base.htmlExtract` | none | `Formatter by Zapier` |
| `step.noop` | mapped | dropped, recorded as info | `n8n-nodes-base.noOp` | `identity` | none |
| `step.subworkflow` | needs-person | a model stage naming the child workflow | `n8n-nodes-base.executeWorkflow` | `script`, `flow` | none |
| `step.wait-approval` | mapped | a gate stage | `n8n-nodes-base.form` | none | none |
| `step.wait-time` | partial | "on the next run"; delays become run boundaries | `n8n-nodes-base.wait` | none | `Delay by Zapier` |
| `step.respond` | needs-person | output goes to the Desk Inbox, not to a webhook caller | `n8n-nodes-base.respondToWebhook` | none | none |
| `step.store` | partial | a store collection state/<id> | `n8n-nodes-base.dataTable`, `n8n-nodes-base.dataTableTool`, `n8n-nodes-base.writeBinaryFile`, `n8n-nodes-base.readWriteFile`, `n8n-nodes-base.redis` | none | `Storage by Zapier` |
| `step.note` | mapped | sticky note text goes to the pack readme | `n8n-nodes-base.stickyNote` | none | none |
| `step.unknown` | unmapped | reported, and kept as a model stage titled "Needs a person" | none | none | none |
| `output.desk` | mapped | results become Desk items (entities) and Inbox messages | none | none | none |
| `expression` | partial | explicit stage inputs; complex code flagged | none | none | none |
| `credential` | needs-person | a connector to set up, by type and name only | none | none | none |
| `failure.node` | partial | the prompt's failure rule for that stage (continue, stop) | `n8n-nodes-base.stopAndError` | none | none |
| `failure.workflow` | mapped | failure handling, as trigger.error | none | none | none |

## Apps

The Claude connector column has two values. `verified` means the app was listed as a claude.ai connector on 2026-10-30, in the session that built this map. `unverified` means it was not on that list. An unverified app falls back to Zapier MCP (connector kind `mcp`) and the report marks it unverified. Neither value says the connector can do everything the source workflow did. Language model providers such as OpenAI are not apps: they map to `step.ai-model` and `step.llm`.

The message column says whether an action on the app counts as sending a message (the pack action kind is `send`). Other write actions are `post`, or `delete` when the step operation is a delete.

| Id | Label | Claude connector | Message |
|---|---|---|---|
| `gmail` | Gmail | verified | yes |
| `slack` | Slack | verified | yes |
| `googleSheets` | Google Sheets | unverified | no |
| `googleDrive` | Google Drive | verified | no |
| `googleCalendar` | Google Calendar | verified | no |
| `googleDocs` | Google Docs | unverified | no |
| `googleCloudStorage` | Google Cloud Storage | unverified | no |
| `googleAds` | Google Ads | unverified | no |
| `facebook` | Facebook Graph API | unverified | no |
| `rssFeed` | RSS feed | unverified | no |
| `googleAnalytics` | Google Analytics | unverified | no |
| `awsS3` | AWS S3 | unverified | no |
| `notion` | Notion | verified | no |
| `airtable` | Airtable | unverified | no |
| `hubspot` | HubSpot | unverified | no |
| `salesforce` | Salesforce | unverified | no |
| `shopify` | Shopify | unverified | no |
| `stripe` | Stripe | unverified | no |
| `telegram` | Telegram | unverified | yes |
| `discord` | Discord | unverified | yes |
| `microsoftOutlook` | Microsoft Outlook | unverified | yes |
| `microsoftTeams` | Microsoft Teams | unverified | yes |
| `microsoftExcel` | Microsoft Excel | unverified | no |
| `jira` | Jira | verified | no |
| `confluence` | Confluence | verified | no |
| `github` | GitHub | unverified | no |
| `gitlab` | GitLab | unverified | no |
| `clickup` | ClickUp | verified | no |
| `mondayCom` | monday.com | verified | no |
| `trello` | Trello | unverified | no |
| `asana` | Asana | unverified | no |
| `postgres` | Postgres | unverified | no |
| `mysql` | MySQL | unverified | no |
| `supabase` | Supabase | unverified | no |
| `http` | HTTP request | unverified | no |
| `emailSend` | Email (SMTP) | unverified | yes |
| `twilio` | Twilio | unverified | yes |
| `whatsApp` | WhatsApp | unverified | yes |
| `mailchimp` | Mailchimp | unverified | yes |
| `typeform` | Typeform | unverified | no |
| `zendesk` | Zendesk | unverified | no |
| `intercom` | Intercom | unverified | yes |
| `linear` | Linear | unverified | no |
| `dropbox` | Dropbox | unverified | no |
| `wordpress` | WordPress | unverified | no |
| `youtube` | YouTube | unverified | no |
| `twitter` | X (Twitter) | unverified | no |
| `linkedin` | LinkedIn | unverified | no |
| `figma` | Figma | verified | no |
| `bigquery` | BigQuery | verified | no |
| `cloudflare` | Cloudflare | verified | no |
| `sendGrid` | SendGrid | unverified | yes |
| `pipedrive` | Pipedrive | unverified | no |
| `mongoDb` | MongoDB | unverified | no |

## Read operations

An operation counts as a read only when it is in `read_operations`: `get`, `getAll`, `getMany`, `list`, `search`, `read`, `lookup`, `download`, `find`, `select`. A missing or unknown operation counts as a write, so the routine comes out approval-gated.

## Before the gate

Only these step concepts may run before the approval gate, and only when they read: `step.app`, `step.http`, `step.llm`, `step.agent`, `step.transform`, `step.branch`, `step.merge`, `step.loop`, `step.ai-tool`, `step.ai-model`, `step.ai-output-parser`, `step.wait-time` and `step.store`. An app or http step needs explicit read access, a store step needs a read operation, and a write connector or write access always moves the step after the gate. Every other step (code, subworkflow, respond, unknown, approval, memory, vector) runs after the gate, so a routine that has one is approval-gated even when nothing in it is known to write. A step that needs a later step or the gate moves after the gate with it. An agent tool with no app, http, workflow, code or vector mapping (for example a calculator, a search tool or an MCP client) makes its agent step a write, so the agent runs after the gate and the tool raises a needs-person issue.
