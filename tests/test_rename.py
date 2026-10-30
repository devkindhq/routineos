import os
import re
import subprocess
import sys
import tomllib
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "skills", "routineos", "scripts")
sys.path.insert(0, SCRIPTS)

import schema  # noqa: E402

# Built by concatenation so this file never contains the retired words.
RETIRED = re.compile("|".join(["kn" + "ob", "cad" + "enza"]), re.I)


def repo_text_files():
    # Tracked files plus untracked files that are not ignored; ignored scratch is skipped.
    out = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout.decode("utf-8")
    for rel in sorted(set(p for p in out.split("\0") if p)):
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            continue
        with open(path, "rb") as fh:
            data = fh.read()
        if b"\0" in data:
            continue
        try:
            yield rel, data.decode("utf-8")
        except UnicodeDecodeError:
            continue


def retired_hits(files):
    hits = []
    for rel, text in files:
        if RETIRED.search(rel):
            hits.append(f"{rel}:path")
        for n, line in enumerate(text.splitlines(), 1):
            if RETIRED.search(line):
                hits.append(f"{rel}:{n}")
    return hits


class RenameTests(unittest.TestCase):
    def test_no_retired_words_in_repo(self):
        hits = retired_hits(repo_text_files())
        self.assertEqual(hits, [], "retired words found:\n" + "\n".join(hits))

    def test_scanner_catches_markdown_js_and_toml(self):
        samples = [
            ("a.md", "Tune the " + "Kn" + "ob here"),
            ("b.js", "const x = '" + "CAD" + "ENZA';"),
            ("c.toml", "[[" + "kn" + "ob]]\nname = \"x\""),
        ]
        self.assertEqual(retired_hits(samples), ["a.md:1", "b.js:1", "c.toml:1"])

    def test_skill_folder_renamed(self):
        self.assertTrue(os.path.isdir(os.path.join(ROOT, "skills", "routineos")))
        self.assertFalse(os.path.exists(os.path.join(ROOT, "skills", "cad" + "enza")))

    def test_routine_toml_uses_setting_tables(self):
        found = 0
        for rel, _text in repo_text_files():
            if os.path.basename(rel) != "routine.toml":
                continue
            with open(os.path.join(ROOT, rel), "rb") as fh:
                try:
                    cfg = tomllib.load(fh)
                except tomllib.TOMLDecodeError:
                    continue  # deliberately malformed fixtures
            self.assertFalse([k for k in cfg if k not in ("routine", "store", "workspace", "setting", "gate", "action")],
                             f"unexpected top-level table in {rel}: {list(cfg)}")
            found += len(cfg.get("setting", []))
        self.assertGreater(found, 0)

    def test_schema_exposes_setting_types(self):
        self.assertEqual(schema.SETTING_TYPES, ("toggle", "number", "choice", "list"))

    def test_run_docs_use_settings_used(self):
        names = set()
        for rel, text in repo_text_files():
            if rel.startswith(("skills/", "templates/")):
                names.update(re.findall(r"\b([a-z]+)_used\b", text))
        self.assertEqual(names, {"settings"})


if __name__ == "__main__":
    unittest.main()
