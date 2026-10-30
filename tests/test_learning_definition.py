"""The definition `learning` block: lint, defaults, compile, and the default-on scaffold."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
CLI = os.path.join(SCRIPTS, "routineos.py")
JOBS = os.path.join(ROOT, "templates", "jobs-watch")
sys.path.insert(0, SCRIPTS)

import definition  # noqa: E402
import schema  # noqa: E402


def jobs():
    return definition.load(os.path.join(JOBS, "definition.json")), schema.load(os.path.join(JOBS, "routine.toml"))["setting"]


class LearningLint(unittest.TestCase):
    def problems(self, learning, settings=None):
        defn, s = jobs()
        defn["learning"] = learning
        return definition.lint(defn, settings if settings is not None else s)

    def test_minimal_block_is_clean(self):
        self.assertEqual(self.problems({"enabled": True}), [])

    def test_full_block_is_clean(self):
        self.assertEqual(self.problems({"enabled": True, "signals": {"dead_item": False}, "minSample": 3, "minEffect": 0.5,
                                        "cooldownDays": 7, "maxPerRun": 2, "deadAfterRuns": 5,
                                        "limits": ["max_inbox_per_run"]}), [])

    def test_unknown_key(self):
        self.assertTrue(any("unknown key 'autoApply'" in p for p in self.problems({"enabled": True, "autoApply": True})))

    def test_unknown_signal_and_non_boolean_switch(self):
        probs = self.problems({"enabled": True, "signals": {"vibes": True, "override": "yes"}})
        self.assertTrue(any("unknown signal 'vibes'" in p for p in probs), probs)
        self.assertTrue(any("signals.override must be true or false" in p for p in probs), probs)

    def test_enabled_must_be_boolean(self):
        self.assertTrue(any("enabled must be true or false" in p for p in self.problems({"enabled": "on"})))

    def test_numbers_out_of_range(self):
        for key, bad in (("minSample", 0), ("minEffect", 0), ("minEffect", 1.5), ("cooldownDays", -1),
                         ("maxPerRun", 11), ("deadAfterRuns", 1), ("minSample", True)):
            probs = self.problems({"enabled": True, key: bad})
            self.assertTrue(any(f"learning.{key}" in p for p in probs), (key, bad, probs))

    def test_limit_must_be_known_and_declared(self):
        self.assertTrue(any("learning.limits: 'lookback_days'" in p for p in self.problems({"enabled": True, "limits": ["lookback_days"]})))
        _, s = jobs()
        without = [x for x in s if x["name"] != "max_inbox_per_run"]
        defn, _ = jobs()
        defn["inbox"] = False
        defn["learning"] = {"enabled": True, "limits": ["max_inbox_per_run"]}
        self.assertTrue(any("not a declared number setting" in p for p in definition.lint(defn, without)))

    def test_never_learnable_binding_refused(self):
        defn, s = jobs()
        s = s + [{"name": "send_to", "type": "list", "role": "include", "default": []}]
        defn["types"]["role"]["settingFilters"].append({"setting": "send_to", "field": "market"})
        defn["learning"] = {"enabled": True}
        self.assertTrue(any("send_to is never learnable" in p for p in definition.lint(defn, s)))

    def test_never_learnable_names(self):
        for name in ("push_rule", "gate_timeout", "send_permission", "alert_channel", "max_runs_per_day", "inbox_cap_override", "budget",
                     "PushRule", "SendTo", "maxRuns", "Cap-Override", "GATE_timeout", "AlertChannel"):
            self.assertTrue(definition.never_learnable(name), name)
        for name in ("markets", "title_keywords", "excluded_companies", "max_inbox_per_run", "lookback_days"):
            self.assertFalse(definition.never_learnable(name), name)


class LearningConfig(unittest.TestCase):
    def test_absent_block_is_off(self):
        self.assertIsNone(definition.learning_config(None))

    def test_defaults_filled(self):
        cfg = definition.learning_config({"enabled": True})
        self.assertEqual(cfg["minSample"], 5)
        self.assertEqual(cfg["minEffect"], 0.6)
        self.assertEqual(cfg["cooldownDays"], 14)
        self.assertEqual(cfg["maxPerRun"], 3)
        self.assertEqual(cfg["deadAfterRuns"], 10)
        self.assertEqual(cfg["limits"], [])
        self.assertEqual(set(cfg["signals"]), set(definition.SIGNALS))
        self.assertTrue(all(cfg["signals"].values()))

    def test_signal_switch_kept(self):
        cfg = definition.learning_config({"enabled": True, "signals": {"dead_item": False}})
        self.assertFalse(cfg["signals"]["dead_item"])
        self.assertTrue(cfg["signals"]["override"])

    def test_nine_signals(self):
        self.assertEqual(definition.SIGNALS, ("override", "uncaptured_term", "dead_item", "source_health", "limit_pressure",
                                              "connections", "edit_drift", "manual_repetition", "people_drop"))


class LearningCompile(unittest.TestCase):
    def producer(self, defn, settings):
        return {"id": "jobs-watch", "label": "Jobs watch", "schedule": "0 22 * * *", "definition": defn, "settings": settings}

    def test_without_block_compiled_has_no_learning(self):
        defn, s = jobs()
        defn.pop("learning", None)
        compiled = definition.compile([self.producer(defn, s)])
        self.assertNotIn("learning", compiled["producers"][0])

    def test_with_block_compiled_carries_config(self):
        defn, s = jobs()
        defn.pop("learning", None)
        plain = definition.compile([self.producer(dict(defn), s)])
        defn["learning"] = {"enabled": True, "limits": ["max_inbox_per_run"]}
        compiled = definition.compile([self.producer(defn, s)])
        self.assertEqual(compiled["producers"][0]["learning"]["limits"], ["max_inbox_per_run"])
        self.assertNotEqual(plain["version"], compiled["version"])


class DefaultOnScaffold(unittest.TestCase):
    def test_new_watch_definition_learns_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "my-watch")
            r = subprocess.run([sys.executable, CLI, "new", "my-watch", "--type", "watch", "--dir", target], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            with open(os.path.join(target, "definition.json"), encoding="utf-8") as fh:
                self.assertEqual(json.load(fh)["learning"], {"enabled": True})
            r = subprocess.run([sys.executable, CLI, "lint", target], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == "__main__":
    unittest.main()
