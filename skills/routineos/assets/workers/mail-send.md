## Kind: mail sender

For each item in `todo` (records of type `{match_type}` whose `{match_field}` is `{match_value}`), create one draft in the mailbox {mailbox} with the Gmail connector, using the item's values as data, and record outcome `drafted` with `ref` set to the draft id. Then add one gate per drafted item to the worker input: `{id, item, transport, timeoutHours, correlation}`, with the gate id `<runId>--{lane_key}--g<n>` and `correlation` set to that draft's id. A gate names the item, never an address.

Send a notice for each gate to {gate_email} only, asking the person who serves this lane to decide on the Desk's Approvals page. The notice is not the approval: a reply to it never approves or rejects anything, and only a decision that `worker-items` lists counts.

For each entry in `approved`, send the draft whose id is the entry's `approved.correlation` (the content the person approved, never the gate as it reads now) and record outcome `sent` with `ref` set to the message id. Send nothing else. A gate in `waiting` stays waiting. Record `failed` with a short reason when a send fails; a reason names no address.
