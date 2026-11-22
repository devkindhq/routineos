import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REQUIRED = [
    "skills/routineos/references/write-contract.md",
    "tests/visual/shell.test.mjs",
    "skills/routineos/registry/capabilities.toml",
]


def stale_versions(root, version):
    """Return a list of problems: missing required files or versions other than `version`."""
    problems = []
    for rel in REQUIRED:
        path = root / rel
        if not path.exists():
            problems.append("missing required file: " + rel)
            continue
        found = set(re.findall(r"0\.2\.\d+", path.read_text(encoding="utf-8")))
        if not found <= {version}:
            problems.append(rel + " mentions " + ", ".join(sorted(found)))
    return problems


class ContractVersionTest(unittest.TestCase):
    def test_contract_version_single_source(self):
        src = (ROOT / "skills/routineos/scripts/desk_contract.py").read_text(encoding="utf-8")
        version = re.search(r"contract (\d+\.\d+\.\d+)", src).group(1)
        self.assertEqual(stale_versions(ROOT, version), [])

    def write_all(self, root, texts):
        for rel in REQUIRED:
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_text(texts.get(rel, "contract 0.2.93"), encoding="utf-8")

    def test_missing_required_file_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_all(root, {})
            missing = "skills/routineos/registry/capabilities.toml"
            (root / missing).unlink()
            self.assertEqual(
                stale_versions(root, "0.2.93"),
                ["missing required file: " + missing],
            )

    def test_stale_version_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            stale = "skills/routineos/registry/capabilities.toml"
            self.write_all(root, {stale: "contract 0.2.92"})
            self.assertEqual(
                stale_versions(root, "0.2.93"),
                [stale + " mentions 0.2.92"],
            )


if __name__ == "__main__":
    unittest.main()
