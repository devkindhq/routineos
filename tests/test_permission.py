import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "routineos", "scripts"))
import permission  # noqa: E402

HEADINGS = ["Apps and hosts", "Connectors", "Schedule", "Environment and secrets",
            "Store", "Budget", "First run", "Not yet checked"]


def make_app(**over):
    app = {
        "app": {"id": "jobs", "title": "Jobs Watch", "status": "not live"},
        "routine": [{"name": "collect", "schedule": "0 22 * * 1-5", "connectors": ["gmail"],
                     "hosts": ["api.adzuna.com"], "writes": ["listings"], "environment": "jobs-env"}],
        "integration": [
            {"name": "gmail", "kind": "connector", "direction": "read", "what": "read job emails"},
            {"name": "adzuna", "kind": "secret-host", "direction": "read", "hosts": ["api.adzuna.com"],
             "what": "job search API"}],
        "secret": [{"name": "adzuna-key", "where": "network-secret", "host": "api.adzuna.com"}],
        "collection": [{"name": "listings", "writer": "collect"}],
        "store": {"kind": "artifact-db"},
        "budget": {"max_runs_per_day": 4, "alert_channel": "email"},
        "risks": {"relies_on": []},
    }
    app.update(over)
    return app


RECORDS = {
    "script-writes-store": {"id": "script-writes-store", "claim": "scripts write", "status": "unverified",
                            "lead": "owner-reported, not re-tested"},
    "run-writes-artifact-db": {"id": "run-writes-artifact-db", "claim": "runs write db",
                               "status": "pilot-verified"},
}


class RunsPerDayTests(unittest.TestCase):
    def test_runs_per_day(self):
        cases = {"0 22 * * 1-5": 1, "0 */6 * * *": 4, "30 * * * *": 24, "0 9,17 * * *": 2,
                 "0 8-10 * * *": 3, "not a cron": None}
        for cron, want in cases.items():
            self.assertEqual(permission.runs_per_day(cron), want, cron)


class RunsPerDayEdgeTests(unittest.TestCase):
    def test_step_and_range_forms(self):
        self.assertEqual(permission.runs_per_day("0 5/6 * * *"), 4)
        self.assertEqual(permission.runs_per_day("0 9-17/2 * * *"), 5)
        self.assertEqual(permission.runs_per_day("*/15 * * * *"), 96)

    def test_zero_step_is_none(self):
        self.assertIsNone(permission.runs_per_day("*/0 * * * *"))
        self.assertIsNone(permission.runs_per_day("0 */0 * * *"))

    def test_hour_above_23_is_none(self):
        self.assertIsNone(permission.runs_per_day("0 24 * * *"))
        self.assertIsNone(permission.runs_per_day("0 20-25 * * *"))

    def test_duplicate_minutes_not_double_counted(self):
        self.assertEqual(permission.runs_per_day("0,0 9 * * *"), 1)


class CostShapeTests(unittest.TestCase):
    def test_cost_shape_warns_when_over_daily_cap(self):
        routines = [{"name": "a", "schedule": "30 * * * *"}, {"name": "b", "schedule": "0 * * * *"}]
        app = make_app(routine=routines, budget={"max_runs_per_day": 4})
        text = "\n".join(permission.cost_shape(app))
        over = [ln for ln in permission.cost_shape(app) if "over" in ln]
        self.assertTrue(over)
        self.assertIn("48", over[0])
        self.assertIn("4", over[0])
        self.assertIn("1 hour", text)
        self.assertIn("100", text)
        self.assertIn("30", text)

    def test_cost_shape_no_warning_within_cap(self):
        lines = permission.cost_shape(make_app())
        self.assertFalse(any("over" in ln for ln in lines))


class RenderTests(unittest.TestCase):
    def test_render_lists_every_required_section(self):
        out = permission.render(make_app(), RECORDS)
        pos = [out.find(h) for h in HEADINGS]
        self.assertNotIn(-1, pos)
        self.assertEqual(pos, sorted(pos))

    def test_render_names_secrets_but_never_values(self):
        value = "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"
        app = make_app()
        app["integration"][1]["hosts"] = [value]
        app["integration"][1]["what"] = "key " + value
        app["secret"][0]["host"] = value
        out = permission.render(app, RECORDS)
        self.assertIn("adzuna-key", out)
        self.assertIn("[redacted]", out)
        self.assertNotIn(value, out)

    def test_render_does_not_claim_none_when_nothing_declared(self):
        app = {"app": {"id": "x", "title": "X", "status": "not live"},
               "routine": [{"name": "x", "schedule": "0 22 * * *"}], "budget": {"max_runs_per_day": 1}}
        out = permission.render(app, RECORDS)
        self.assertNotIn("No outside hosts are contacted", out)
        self.assertNotIn("Nothing the app relies on is unverified", out)
        tail = out[out.find("Not yet checked"):]
        self.assertIn("Hosts", tail)
        self.assertIn("not verified", tail)
        self.assertIn("Reliance", tail)

    def test_render_budget_labels_and_plural(self):
        app = make_app(budget={"max_runs_per_day": 1})
        out = permission.render(app, RECORDS)
        self.assertIn("prompt-enforced, not guaranteed", out)
        self.assertIn("1 run a day", out)
        self.assertNotIn("1 runs", out)
        self.assertIn("no alert channel is set", out)

    def test_render_lists_unverified_dependencies_with_tag(self):
        app = make_app(risks={"relies_on": ["script-writes-store", "run-writes-artifact-db"]})
        out = permission.render(app, RECORDS)
        tail = out[out.find("Not yet checked"):]
        line = [ln for ln in tail.splitlines() if "script-writes-store" in ln]
        self.assertEqual(len(line), 1)
        self.assertIn("unverified", line[0])
        self.assertIn("owner-reported, not re-tested", line[0])
        self.assertNotIn("run-writes-artifact-db", tail)

    def test_render_labels_utc_cron_and_timezone(self):
        app = make_app()
        app["routine"][0]["timezone"] = "Australia/Melbourne"
        sched = permission.render(app, RECORDS).split("Schedule")[1].split("Environment")[0]
        self.assertIn("UTC", sched)
        self.assertIn("0 22 * * 1-5", sched)
        self.assertIn("Australia/Melbourne", sched)

    def test_render_never_prints_other_secret_fields(self):
        planted = "sk-test-123456"
        app = make_app()
        app["secret"][0].update({"value": planted, "token": planted, "note": planted})
        self.assertNotIn(planted, permission.render(app, RECORDS))

    def test_render_flags_unknown_dependency(self):
        out = permission.render(make_app(risks={"relies_on": ["ghost"]}), RECORDS)
        self.assertIn("ghost", out[out.find("Not yet checked"):])

    def test_render_states_first_run_is_report_only(self):
        out = permission.render(make_app(), RECORDS)
        self.assertIn("report-only", out)
        self.assertIn("nothing is sent", out)

    def test_render_shows_schedule_and_runs(self):
        out = permission.render(make_app(), RECORDS)
        self.assertIn("0 22 * * 1-5", out)
        self.assertIn("1 run", out)

    def test_render_has_no_em_dash(self):
        self.assertNotIn(chr(0x2014), permission.render(make_app(), RECORDS))


DELIVERY_RECORDS = dict(RECORDS, **{"repo-less-routine": {
    "id": "repo-less-routine", "claim": "repo-less accepted", "status": "unverified",
    "lead": "inference from docs silence"}})


class DeliveryRenderTests(unittest.TestCase):
    def render(self, records=DELIVERY_RECORDS, **routine):
        app = make_app()
        app["routine"][0].update(routine)
        return permission.render(app, records)

    def test_default_routine_shows_repo_and_no_repo_less_line(self):
        out = self.render()
        self.assertIn("Logic delivered by\n- collect: repo\n", out)
        self.assertNotIn("repo-less-routine", out)

    def test_repo_with_name(self):
        self.assertIn("- collect: repo acme/jobs", self.render(delivery="repo", repo="acme/jobs"))

    def test_account_skill_shows_name_and_cites_registry_id(self):
        out = self.render(delivery="account-skill", skill="scan-jobs")
        self.assertIn("- collect: account skill scan-jobs", out)
        tail = out.split("Not yet checked")[1]
        self.assertIn("- repo-less-routine: unverified; inference from docs silence", tail)

    def test_inline_shows_inline_prompt_and_unverified_item(self):
        out = self.render(delivery="inline")
        self.assertIn("- collect: inline prompt", out)
        self.assertIn("repo-less-routine: unverified", out.split("Not yet checked")[1])

    def test_missing_registry_record_is_still_listed(self):
        out = self.render(records={}, delivery="inline")
        self.assertIn("- repo-less-routine: unverified, not in the capability registry", out)

    def test_verified_record_is_not_listed(self):
        records = {"repo-less-routine": {"id": "repo-less-routine", "claim": "c", "status": "pilot-verified"}}
        self.assertNotIn("repo-less-routine", self.render(records=records, delivery="inline").split("Not yet checked")[1])


class EnvironmentRenderTests(unittest.TestCase):
    def render(self, env=None, records=RECORDS, **over):
        app = make_app(**over)
        if env is not None:
            app["environment"] = env
        return permission.render(app, records)

    def section(self, out):
        return out.split("Environment and secrets\n")[1].split("\n\nStore")[0]

    def test_unreported_environment_says_it_cannot_be_read(self):
        out = self.render()
        self.assertIn("- Environment settings: not reported. RoutineOS cannot read", self.section(out))
        self.assertIn("- Environment settings: not reported, so no host's reachability is checked.",
                      out.split("Not yet checked")[1])

    def test_block_lists_every_reported_setting(self):
        env = {"name": "jobs-env", "network": "limited", "allowed_domains": ["boards.example.com"],
               "setup_script": True, "env_vars": ["LOG_LEVEL"]}
        sec = self.section(self.render(env))
        for line in ("- The settings below are reported by you, not readable by RoutineOS.",
                     "- Name: jobs-env", "- Network access: limited", "- Allowed domains: boards.example.com",
                     "- Network secrets (names): adzuna-key", "- Setup script: yes",
                     "- Environment variables (names only): LOG_LEVEL"):
            self.assertIn(line, sec)
        self.assertNotIn("WARNING", sec)

    def test_default_environment_is_flagged_as_shared(self):
        sec = self.section(self.render({"name": "Default", "network": "limited"}))
        self.assertIn("- WARNING: this is a shared environment.", sec)
        self.assertIn("affects every one of them", sec)
        sec = self.section(self.render({"name": "team-env", "shared": True}))
        self.assertIn("- WARNING: this is a shared environment.", sec)

    def test_env_var_values_are_never_printed(self):
        value = "hunter2-very-private"
        out = self.render({"name": "e", "env_vars": ["LOG_LEVEL", f"API_TOKEN={value}", "sk-" + "a1B2c3D4e5F6g7H8i9J0k1L2"]})
        self.assertNotIn(value, out)
        self.assertNotIn("API_TOKEN", out)
        self.assertNotIn("a1B2c3D4e5F6g7H8i9J0k1L2", out)
        self.assertIn("- Environment variables (names only): LOG_LEVEL; 2 more not shown, only plain names are printed", out)

    def test_secret_host_is_reachable_at_any_level(self):
        sec = self.section(self.render({"name": "e", "network": "none"}))
        self.assertIn("- Host api.adzuna.com: reachable: a network secret is attached for it", sec)

    def test_host_reachability_per_level(self):
        app_over = {"secret": [], "routine": [{"name": "collect", "schedule": "0 22 * * 1-5",
                                               "hosts": ["api.adzuna.com"], "connectors": ["gmail"]}]}
        cases = {
            ("limited", ()): "not reachable from network 'limited'",
            ("none", ()): "not reachable from network 'none'",
            ("custom", ("api.adzuna.com",)): "reachable: on the allowed domains you reported",
            ("limited", ("*.adzuna.com",)): "reachable: on the allowed domains you reported",
            ("full", ()): "reachable if the Full level you reported is right",
            ("trusted", ()): "reachable only if it is on the platform's Trusted default list",
        }
        for (level, doms), want in cases.items():
            out = self.render({"name": "e", "network": level, "allowed_domains": list(doms)}, **app_over)
            self.assertIn(f"- Host api.adzuna.com: {want}", self.section(out), (level, doms))
            listed = "- Host api.adzuna.com" in out.split("Not yet checked")[1]
            self.assertEqual(listed, not want.startswith("reachable:") and not want.startswith("reachable if"), level)

    def test_wildcard_does_not_match_another_domain(self):
        out = self.render({"name": "e", "network": "limited", "allowed_domains": ["*.adzuna.com"]},
                          secret=[], routine=[{"name": "c", "hosts": ["evil-adzuna.com"]}],
                          integration=[{"name": "x", "kind": "http", "hosts": ["evil-adzuna.com"]}])
        self.assertIn("- Host evil-adzuna.com: not reachable", out)

    def test_connector_reads_do_not_depend_on_network(self):
        sec = self.section(self.render({"name": "e", "network": "none"}))
        self.assertIn("- Connector gmail: read through the connector, which does not depend on the network level [docs]", sec)


class ToolsRenderTests(unittest.TestCase):
    def test_tools_section_lists_declared_tools_and_forbids_unlisted_sends(self):
        app = make_app()
        app["routine"][0]["tools"] = ["Bash", "Read", "WebFetch"]
        out = permission.render(app, RECORDS)
        sec = out.split("Tools the run may use\n")[1].split("\n\n")[0]
        self.assertIn("- collect: Bash, Read, WebFetch", sec)
        self.assertIn("may not use a send tool (push, email, Slack or any other) that this screen does not list", sec)

    def test_undeclared_tools_are_said_plainly(self):
        self.assertIn("- collect: no tool list declared in app.toml", permission.render(make_app(), RECORDS))


class RepoLessOnceTests(unittest.TestCase):
    def test_repo_less_line_appears_once_when_also_relied_on(self):
        app = make_app(risks={"relies_on": ["repo-less-routine"]})
        app["routine"][0]["delivery"] = "inline"
        out = permission.render(app, DELIVERY_RECORDS)
        self.assertEqual(out.count("- repo-less-routine:"), 1)
        out = permission.render(app, {})
        self.assertEqual(out.count("- repo-less-routine:"), 1)


if __name__ == "__main__":
    unittest.main()
