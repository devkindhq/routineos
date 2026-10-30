## Kind: mail drafts

For each item in `todo` (records of type `{match_type}` whose `{match_field}` is `{match_value}`), create one draft in the mailbox {mailbox} with the Gmail connector, using the item's values as data. Never send, post or delete any message, and never ask to.

Record one outcome per item in the worker input: `drafted` with `ref` set to the draft id, `skipped` with a short reason when the item cannot be drafted, or `failed` with a short reason when the connector call fails. A reason names no address. This kind has no gates.
