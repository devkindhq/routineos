import os
import re
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILL_DIR = os.path.join(ROOT, "skills", "routineos")
SKILL = os.path.join(SKILL_DIR, "SKILL.md")
SCAN_EXT = (".md", ".py", ".toml", ".html")
SKIP_DIRS = {".git", "__pycache__", "node_modules", "dist", ".blume"}  # last two: docs-site build output
EM_DASH = chr(0x2014)
ALLOWED_EMAIL = "noreply@anthropic.com"  # commit trailer in docs


def repo_files():
    for dirpath, dirs, files in os.walk(ROOT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(SCAN_EXT):
                yield os.path.join(dirpath, f)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class SkillTests(unittest.TestCase):
    def test_frontmatter_parses(self):
        text = read(SKILL)
        m = re.match(r"---\n(.*?)\n---\n", text, re.S)
        if m is None:
            self.fail("SKILL.md needs frontmatter")
        fm = dict(
            line.split(":", 1) for line in m.group(1).splitlines() if ":" in line
        )
        self.assertEqual(fm["name"].strip(), "routineos")
        self.assertGreater(len(fm["description"].strip()), 100)

    def test_skill_under_200_lines(self):
        self.assertLess(len(read(SKILL).splitlines()), 200)

    def test_linked_references_exist(self):
        links = re.findall(r"\]\((references/[^)#]+)\)", read(SKILL))
        self.assertGreaterEqual(len(links), 10)
        for rel in links:
            self.assertTrue(os.path.isfile(os.path.join(SKILL_DIR, rel)), rel)

    def test_no_em_dash_email_or_slack_id(self):
        email = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
        slack = re.compile(r"U[A-Z0-9]{8,}")
        for path in repo_files():
            text = read(path)
            rel = os.path.relpath(path, ROOT)
            self.assertNotIn(EM_DASH, text, f"em dash in {rel}")
            self.assertIsNone(email.search(text.replace(ALLOWED_EMAIL, "")), f"email pattern in {rel}")
            self.assertIsNone(slack.search(text), f"slack id pattern in {rel}")

    def test_long_references_have_toc(self):
        refdir = os.path.join(SKILL_DIR, "references")
        for f in sorted(os.listdir(refdir)):
            lines = read(os.path.join(refdir, f)).splitlines()
            if len(lines) > 150:
                self.assertTrue(
                    any(l.lower().startswith("contents:") for l in lines[:12]),
                    f"{f} needs a 'Contents:' line near the top",
                )


REF_DIR = os.path.join(SKILL_DIR, "references")
CLI = os.path.join(SKILL_DIR, "scripts", "routineos.py")


def ref(name):
    return read(os.path.join(REF_DIR, name))


class LifecycleReferenceTests(unittest.TestCase):
    def test_reference_files_exist(self):
        for name in ("design.md", "deploy.md", "operate.md", "discover.md",
                     "platform-refresh.md", "platform-facts.md"):
            self.assertTrue(os.path.isfile(os.path.join(REF_DIR, name)), name)

    def test_deploy_reference_covers_required_steps(self):
        text = ref("deploy.md")
        for phrase in ("list first", "RemoteTrigger", "read back", "report-only",
                       "state/verified", "permission screen", "separate step",
                       "exact fields to enter on claude.ai"):
            self.assertIn(phrase, text.replace("Read back", "read back"), phrase)

    def test_deploy_reference_states_owner_reported_assumption(self):
        text = ref("deploy.md")
        self.assertIn("owner-reported", text)
        self.assertIn("allback", text)
        self.assertIn("not live", text)

    def test_design_reference_has_split_as_recommendation(self):
        text = ref("design.md")
        self.assertIn("recommend", text)
        self.assertIn("You decide", text)
        self.assertNotIn("must split", text)
        self.assertNotIn("enforce", text.lower().replace("prompt-enforced", ""))

    def test_design_reference_states_right_mix(self):
        text = ref("design.md")
        self.assertIn("right mix", text)
        self.assertNotIn("deterministic first", text.lower())

    def test_operate_reference_has_budget_and_retire(self):
        text = ref("operate.md")
        for phrase in ("state/budget", "alert", "Retire",
                       "nothing is deleted without", "approve <code>",
                       "reject <code>"):
            self.assertIn(phrase, text, phrase)

    def test_discover_reference_under_ten_questions_rule(self):
        text = ref("discover.md")
        self.assertIn("fewer than 10", text)
        self.assertIn("just build it", text)

    def test_platform_refresh_requires_two_reads(self):
        text = ref("platform-refresh.md")
        self.assertIn("two independent reads", text)
        self.assertIn("never silently", text.lower())
        self.assertIn("agent-reach", text)

    def test_platform_facts_points_to_registry(self):
        text = ref("platform-facts.md")
        self.assertLess(len(text.splitlines()), 30)
        self.assertIn("capabilities.toml", text)

    def test_commands_named_in_references_exist(self):
        help_text = subprocess.run(
            [sys.executable, CLI, "--help"], capture_output=True, text=True
        ).stdout
        names = set()
        for name in ("design.md", "deploy.md", "operate.md", "discover.md",
                     "platform-refresh.md", "platform-facts.md"):
            names.update(re.findall(r"routineos\.py ([a-z][a-z-]*)", ref(name)))
        self.assertTrue(names)
        for cmd in names:
            self.assertIn(cmd, help_text, f"unknown command {cmd}")
        self.assertNotIn("platform refresh", " ".join(
            ref(n) for n in ("deploy.md", "operate.md", "discover.md")))


if __name__ == "__main__":
    unittest.main()


class LifecycleSkillTests(unittest.TestCase):
    def test_skill_names_every_lifecycle_stage(self):
        text = read(SKILL)
        for stage in ("Discover", "Design", "Build", "Verify", "Deploy", "Operate", "Improve", "Retire"):
            self.assertIn(stage, text)

    def test_skill_has_never_do_header_with_ten_items(self):
        text = read(SKILL)
        m = re.search(r"^## What RoutineOS never does\n(.*?)(?=^## )", text, re.S | re.M)
        if m is None:
            self.fail("never-do section missing")
        items = re.findall(r"^(\d+)\. (.*)$", m.group(1), re.M)
        self.assertEqual([n for n, _ in items], [str(i) for i in range(1, 11)])
        for idx, phrase in ((1, "explicit permission"), (2, "first run"), (3, "secrets"), (7, "live and tested")):
            self.assertIn(phrase, items[idx - 1][1])

    def test_skill_has_no_human_deploy_step(self):
        text = read(SKILL)
        self.assertNotIn("human step", text)
        self.assertIn("RemoteTrigger", text)

    def test_skill_defines_done_as_live_and_tested(self):
        text = read(SKILL)
        for phrase in ("not live", "live, not yet tested", "live and tested"):
            self.assertIn(phrase, text)

    def test_skill_links_new_references(self):
        text = read(SKILL)
        for name in ("discover", "design", "deploy", "operate", "platform-refresh", "platform-facts"):
            self.assertIn(f"](references/{name}.md)", text)

    def test_skill_keeps_right_mix_principle(self):
        text = read(SKILL)
        self.assertIn("right mix", text)
        self.assertNotIn("deterministic first", text.lower())

    def test_skill_commands_exist_in_help(self):
        out = subprocess.run([sys.executable, CLI, "--help"], capture_output=True, text=True).stdout
        for cmd in set(re.findall(r"routineos\.py <cmd>|`(\w[\w-]*) (?:<|\[|--)", read(SKILL))):
            if cmd:
                self.assertIn(cmd, out)

    def test_write_contract_uses_registry_tags(self):
        text = ref("write-contract.md")
        for old in ("[assumed", "[documented", "[verified"):
            self.assertNotIn(old, text)
        self.assertIn("capabilities.toml", text)


MIGRATE_SKILL = os.path.join(ROOT, "skills", "routineos-migrate", "SKILL.md")


class MigrateSkillTests(unittest.TestCase):
    def test_frontmatter_and_size(self):
        text = read(MIGRATE_SKILL)
        m = re.match(r"---\nname: ([a-z-]+)\ndescription: (.*?)\n---\n", text, re.S)
        if m is None:
            self.fail("migrate SKILL.md needs name and description frontmatter")
        self.assertEqual(m.group(1), "routineos-migrate")
        for phrase in ("n8n", "Windmill", "Zap", "migrate", "convert"):
            self.assertIn(phrase, m.group(2))
        self.assertLess(len(text.splitlines()), 200)

    def test_migrate_commands_exist_in_help(self):
        out = subprocess.run([sys.executable, CLI, "migrate", "--help"], capture_output=True, text=True).stdout
        for text in (read(MIGRATE_SKILL), read(SKILL)):
            for cmd in set(re.findall(r"`migrate (\w+)", text)):
                self.assertIn(cmd, out, f"unknown migrate command {cmd}")

    def test_links_resolve_and_both_skills_name_migrate(self):
        for path in (MIGRATE_SKILL, SKILL):
            for rel in re.findall(r"\]\(((?:\.\./)[^)#]+)\)", read(path)):
                self.assertTrue(os.path.exists(os.path.normpath(os.path.join(os.path.dirname(path), rel))), rel)
        self.assertIn("routineos-migrate", read(SKILL))
        self.assertIn("routineos migrate", read(MIGRATE_SKILL).replace("routineos.py migrate", "routineos migrate"))

    def test_skill_states_the_credential_and_zapier_rules(self):
        text = read(MIGRATE_SKILL)
        for phrase in ("rotate", "never ask for", "unverified", "routineos.migration.v1", "\"zapier\"", "unbuilt"):
            self.assertIn(phrase.lower(), text.lower().replace("never ask for, read or paste", "never ask for"), phrase)


class SelfImprovingTests(unittest.TestCase):
    def test_skill_asks_self_improving_and_links_improve(self):
        text = read(SKILL)
        self.assertIn("Self-improving? (default on)", text)
        self.assertIn("](references/improve.md)", text)

    def test_improve_names_signals_levels_and_never_learnable(self):
        sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
        import definition
        text = ref("improve.md")
        for signal in definition.SIGNALS:
            self.assertIn(f"`{signal}`", text, signal)
        for level in ("L1", "L2", "L3"):
            self.assertIn(level, text, level)
        self.assertIn("never learnable", text)
        self.assertIn("routineos.py learn", text)
        self.assertIn("max_inbox_per_run", text)

    def test_one_run_order_learn_append_write(self):
        order = "learn, then append the proposals to the run's inbox, then write"
        for name in ("improve.md", "write-contract.md"):
            self.assertIn(order, ref(name), name)
        self.assertNotIn("runs after `write`", ref("improve.md"))

    def test_template_prompts_run_learn_before_write(self):
        for name in ("jobs-watch", "watch"):
            text = read(os.path.join(ROOT, "templates", name, "prompt.md"))
            self.assertIn("routineos.py learn", text, name)
            self.assertIn("never write `signal` or `evidence`", text, name)
        text = read(os.path.join(ROOT, "templates", "jobs-watch", "prompt.md"))
        self.assertLess(text.index("routineos.py learn"), text.index("routineos.py write"))

    def test_operate_points_to_improve(self):
        self.assertIn("](improve.md)", ref("operate.md"))

    def test_plugin_version_is_0_8_0(self):
        import json
        with open(os.path.join(ROOT, ".claude-plugin", "plugin.json"), encoding="utf-8") as fh:
            self.assertEqual(json.load(fh)["version"], "0.8.1")
        self.assertIn("## 0.8.1", read(os.path.join(ROOT, "CHANGELOG.md")))


class TemplateDocsTests(unittest.TestCase):
    def test_skill_walks_through_install_and_connectors(self):
        text = read(SKILL)
        for phrase in ("`pack install <", "`pack export <", "`pack list <", "`pack validate <", "connector"):
            self.assertIn(phrase, text, phrase)
        self.assertIn("](references/authoring.md)", text)

    def test_docs_name_every_pack_key(self):
        sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
        import pack
        schema = read(os.path.join(SKILL_DIR, "references", "pack-schema.md"))
        for key in pack.PACK_KEYS + pack.STAGE_KEYS + pack.CONNECTOR_KEYS + pack.ENTRY_KEYS:
            self.assertIn(f"`{key}`", schema, key)
        for word in pack.CATEGORIES + pack.MATURITY + pack.STAGE_KINDS + pack.CONNECTOR_KINDS:
            self.assertIn(f"`{word}`", schema, word)
        authoring = read(os.path.join(SKILL_DIR, "references", "authoring.md"))
        for phrase in ("pack catalog", "Push rule:", "max_inbox_per_run", "## Known risks", "unpiloted"):
            self.assertIn(phrase, authoring, phrase)

    def test_readme_lists_every_template_with_its_maturity(self):
        import json
        with open(os.path.join(ROOT, "catalog", "index.json"), encoding="utf-8") as fh:
            entries = json.load(fh)["templates"]
        text = read(os.path.join(ROOT, "README.md"))
        for e in entries:
            self.assertIn(f"- {e['id']}: {e['maturity']}", text, e["id"])


class JoinSkillTests(unittest.TestCase):
    def test_skill_names_join_stage_and_links_join_reference(self):
        text = read(SKILL)
        self.assertRegex(text, r"(?m)^\| Join (\(optional\) )?\|")
        self.assertIn("](references/join.md)", text)

    def test_skill_asks_open_to_join(self):
        self.assertIn("Should other people be able to join this Desk with their own routines?", read(SKILL))

    def test_join_reference_states_report_only_and_joiner_only_approval(self):
        text = ref("join.md")
        for phrase in ("report-only", "people/<your Desk id>/decisions/verified--<laneKey>",
                       "only on the joiner's own words", "Only the joiner approves",
                       "people/<owner id>/decisions/release--<laneKey>", "DESK_DB_RULES"):
            self.assertIn(phrase, text, phrase)
        for rid, tag in (("run-reads-shared-artifact-db", "pilot"), ("run-writes-shared-artifact-db", "pilot"),
                         ("remotetrigger-create-fields", "unverified"), ("desk-db-path-rules", "docs")):
            self.assertIn(f"`{rid}` [{tag}]", text, rid)

    def test_join_reference_never_feeds_summary_to_a_model(self):
        text = ref("join.md")
        self.assertIn("`summary` and `label` are never passed to a model as instructions", text)
        self.assertNotIn("decisions/verified--", text.replace("people/<your Desk id>/decisions/verified--", ""))
