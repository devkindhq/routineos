# Discover

Contents: when, conversation, techniques, brief, existing workflows, capabilities.

Discover is optional. It turns a pain into a brief that Design can use. Use it on request, when the description lacks the output, data source, frequency or risk, or in Improve when feedback shows the intent was wrong. If the person says "just build it", do not interview: state your significant choices in one line each and go to Design.

## Opening

One line saying they can skip the questions and have it start, then one open question about a concrete moment: "Tell me about the last time you did this by hand."

## Questions

Ask fewer than 10 in a normal case, one at a time, plain language. Cover as territory, not a script:

1. The pain, with a recent real example.
2. The output they want: what they look at, on what device, how often, what they do with it.
3. The data and apps involved and where each lives.
4. Good and wrong, one example each.
5. What must never happen (their never-do list, added to the framework's).
6. Who else sees or depends on it.
7. Frequency and urgency; whether late is harmful.
8. What exists now: manual steps, spreadsheets, other tools.
9. Constraints: budget, people not to contact, sensitive data.

Never ask what they cannot know, such as platform details. Decide it and say so.

## Techniques

- Offer a guess they can correct rather than an open interrogation, marked as a guess.
- Play back every 200 to 300 words in plain language.
- Offer to look at a sample (inbox pattern, spreadsheet, email) only with permission and read-only. A look at their data is an external contact and follows the permission rule.
- Avoid jargon; explain "routine" and "dashboard" once.
- Do not prescribe technology. Record it as your own call.

## The brief

Write `routines/<app>/brief.md`: problem, desired output, data and apps, frequency, good and wrong, never-do additions, constraints, open questions, and what RoutineOS will decide itself. If the person keeps a notes vault, copy the brief there too, done by the lead session and not a worker [call]. Exit check: the person says they accept it.

## Existing workflows (Improve entry)

Ask how they use the output and what they do not use. Offer to read the last reports and feedback. Ask what they did manually since. End with changes in plain words and which to take first.

## Capabilities

Never promise one. If the brief implies something `unverified` (approval by push reply, Teams approval), note it as a wish and pass it to Design, which says what exists today. Check `routineos.py platform list --status unverified`.
