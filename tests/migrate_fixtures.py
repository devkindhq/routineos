"""Migration plans for the migrate tests. Each function returns a fresh plan dict."""
import os
import sys

SCRIPTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "skills", "routineos", "scripts")
if SCRIPTS not in sys.path:
    sys.path.insert(0, SCRIPTS)


def base(**over):
    plan = {"format": "routineos.migration.v1", "source": {"tool": "n8n", "name": "Example flow"},
            "id": "example-flow", "title": "Example flow", "summary": "Checks a source and reports.",
            "trigger": {"concept": "trigger.schedule", "cron": "0 9 * * 1-5"}, "steps": []}
    plan.update(over)
    return plan


def watch_plan():
    return base(steps=[
        {"id": "fetch-feed", "concept": "step.http", "title": "Fetch feed", "does": "Reads the public feed.",
         "access": "read"},
        {"id": "summarise", "concept": "step.llm", "title": "Summarise", "does": "Summarises new items.",
         "skill": {"system": "You summarise.", "prompt": "Summarise the items."}}])


def gated_plan():
    return base(
        id="reply-to-leads", title="Reply to leads",
        connectors=[{"id": "mail-in", "app": "gmail", "access": "read"},
                    {"id": "mail-out", "app": "gmail", "access": "write"}],
        steps=[
            {"id": "read-mail", "concept": "step.app", "title": "Read mail", "does": "Reads new leads.",
             "app": "gmail", "access": "read", "op": "getAll"},
            {"id": "draft", "concept": "step.llm", "title": "Draft reply", "does": "Drafts a reply.",
             "skill": {"prompt": "Draft a short reply."}},
            {"id": "send-reply", "concept": "step.app", "title": "Send reply", "does": "Sends the reply.",
             "app": "gmail", "access": "write", "op": "send"},
            {"id": "log", "concept": "step.llm", "title": "Log it", "does": "Notes what was sent."}])


def skill_plan(untrusted=False):
    return base(id="agent-flow", title="Agent flow", kind="skill", source={"tool": "n8n", "untrusted": untrusted},
                steps=[{"id": "research", "concept": "step.agent", "title": "Research agent",
                        "does": "Looks things up.", "skill": {"system": "Be careful.", "prompt": "Find facts."}}])


def code_plan():
    return base(id="code-flow", title="Code flow", kind="code", steps=[
        {"id": "transform", "concept": "step.code", "title": "Transform", "does": "Reshapes the rows.",
         "code": {"language": "javascript", "text": "return items.map(i => i);"}}])


def unknown_app_plan():
    return base(id="odd-app", title="Odd app", steps=[
        {"id": "lookup", "concept": "step.app", "title": "Lookup", "does": "Looks up a record.",
         "app": "someCrm", "access": "read", "op": "get"}])


def all_plans():
    return [watch_plan(), gated_plan(), skill_plan(), code_plan(), unknown_app_plan()]
