import ast
import glob
import os
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


def _is_main_guard(node):
    if not isinstance(node, ast.If):
        return False
    test = node.test
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and len(test.comparators) == 1
        and isinstance(test.comparators[0], ast.Constant)
        and test.comparators[0].value == "__main__"
    )


def _is_testcase_base(base):
    if isinstance(base, ast.Attribute):
        return base.attr == "TestCase"
    return isinstance(base, ast.Name) and base.id == "TestCase"


class TestBase(unittest.TestCase):
    def test_no_testcase_after_main_guard(self):
        offenders = []
        for path in sorted(glob.glob(os.path.join(HERE, "test_*.py"))):
            with open(path, encoding="utf-8") as f:
                tree = ast.parse(f.read(), filename=path)
            guards = [n.lineno for n in tree.body if _is_main_guard(n)]
            if not guards:
                continue
            guard = min(guards)
            for node in tree.body:
                if (
                    isinstance(node, ast.ClassDef)
                    and node.lineno > guard
                    and any(_is_testcase_base(b) for b in node.bases)
                ):
                    offenders.append(os.path.basename(path))
                    break
        self.assertEqual(offenders, [], "TestCase classes after the __main__ guard in: " + ", ".join(offenders))


if __name__ == "__main__":
    unittest.main()
