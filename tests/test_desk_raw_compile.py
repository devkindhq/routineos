"""Raw page compiler: import rewrite, default export, JSX transform and the no-node route (spec 5.3, T-B1, T-B6)."""
import hashlib
import os
import shutil
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))

import desk_raw  # noqa: E402

HAVE_NODE = shutil.which("node") is not None
EXPORTS = {
    "react": ["useState", "useEffect", "createElement", "Fragment", "default"],
    "@mantine/core": ["Button", "Text", "Tabs", "Modal", "Group", "Stack"],
    "@mantine/hooks": ["useDisclosure", "useToggle"],
    "@tabler/icons-react": ["IconPlus", "IconTrash"],
    "dayjs": ["default"],
}
PAGE = "export default function Page({ ctx }) { return null; }\n"


def rewrite(source):
    return desk_raw.rewrite_module(source, "p.jsx", EXPORTS)


class RewriteTests(unittest.TestCase):
    def assertProblem(self, imports, line, *fragments):
        hits = [p for p in imports.problems if p.startswith("p.jsx:%d: " % line)]
        self.assertTrue(hits, "no problem at line %d in %r" % (line, imports.problems))
        for fragment in fragments:
            self.assertTrue(any(fragment in p for p in hits), "%r not in %r" % (fragment, hits))

    def test_named_import(self):
        out = rewrite('import { Button, Text as T } from "@mantine/core";\n' + PAGE)
        self.assertEqual(out.problems, [])
        self.assertEqual(out.body.splitlines()[0], 'const { Button, Text: T } = DESK_LIB["@mantine/core"];')

    def test_default_import(self):
        out = rewrite('import X from "dayjs";\n' + PAGE)
        self.assertEqual(out.problems, [])
        self.assertEqual(out.body.splitlines()[0], 'const X = DESK_LIB["dayjs"].default;')

    def test_namespace_import(self):
        out = rewrite('import * as M from "@mantine/hooks";\n' + PAGE)
        self.assertEqual(out.problems, [])
        self.assertEqual(out.body.splitlines()[0], 'const M = DESK_LIB["@mantine/hooks"];')

    def test_multiline_import_with_comments_keeps_line_count(self):
        source = ("// a page\n/* block\n comment */\nimport {\n  Button, // the main action\n  /* inline */ Text as T,\n"
                  "} from '@mantine/core';\nimport { useState } from \"react\";\n" + PAGE)
        out = rewrite(source)
        self.assertEqual(out.problems, [])
        self.assertEqual(out.body.count("\n"), source.count("\n"))
        lines = out.body.splitlines()
        self.assertEqual(lines[3], 'const { Button, Text: T } = DESK_LIB["@mantine/core"];')
        self.assertEqual(lines[7], 'const { useState } = DESK_LIB["react"];')
        self.assertEqual(lines[8], "function Page({ ctx }) { return null; }")

    def test_specifiers_sorted_unique(self):
        out = rewrite('import { useState } from "react";\nimport { Button } from "@mantine/core";\n'
                      'import { useEffect } from "react";\n' + PAGE)
        self.assertEqual(out.specifiers, ["@mantine/core", "react"])

    def test_default_forms(self):
        out = rewrite("export default function (props) { return null; }\n")
        self.assertEqual(out.problems, [])
        self.assertIn("function __Page(props)", out.body)
        out = rewrite("function Page() { return null; }\nexport default Page;\n")
        self.assertEqual(out.problems, [])
        self.assertNotIn("export", out.body)
        self.assertEqual(out.body.count("\n"), 2)
        self.assertNotIn("return Page", out.body)

    def test_unknown_specifier(self):
        self.assertProblem(rewrite('\nimport { map } from "lodash";\n' + PAGE), 2, "lodash")

    def test_unknown_name_suggests(self):
        out = rewrite('import { Buttn } from "@mantine/core";\n' + PAGE)
        self.assertProblem(out, 1, "Buttn", "Button")

    def test_icon_outside_subset(self):
        self.assertProblem(rewrite('import { IconRocket } from "@tabler/icons-react";\n' + PAGE), 1, "IconRocket")

    def test_relative_import(self):
        self.assertProblem(rewrite('import x from "./x";\n' + PAGE), 1, "./x")

    def test_dynamic_import(self):
        self.assertProblem(rewrite(PAGE + 'const m = import("x");\n'), 2, "import(")

    def test_extra_export(self):
        self.assertProblem(rewrite("export const a = 1;\n" + PAGE), 1, "export")

    def test_second_default(self):
        self.assertProblem(rewrite(PAGE + "export default Page;\n"), 2, "export default")

    def test_no_default(self):
        out = rewrite("function Page() { return null; }\n")
        self.assertTrue(out.problems)
        self.assertRegex(out.problems[0], r"^p\.jsx:\d+: .*export default")

    def test_mixed_default_and_named(self):
        self.assertProblem(rewrite('\n\nimport a, { b } from "dayjs";\n' + PAGE), 3, "one form")

    def test_malformed_import_with_comments_is_fast(self):
        start = time.monotonic()
        out = rewrite("\nimport { a " + "/* x */ " * 40 + "} nofrom\n" + PAGE)
        self.assertLess(time.monotonic() - start, 1.0)
        self.assertProblem(out, 2, "unsupported import form")
        start = time.monotonic()
        out = rewrite("import { a /* x */, b /* y */ } from lodash;\n" + PAGE)
        self.assertLess(time.monotonic() - start, 1.0)
        self.assertProblem(out, 1, "unsupported import form")

    def test_comment_with_slashes_and_stars_in_clause(self):
        out = rewrite('import { Button /* a * b / c */, // x/y\n Text } from "@mantine/core";\n' + PAGE)
        self.assertEqual(out.problems, [])
        self.assertEqual(out.body.splitlines()[0], 'const { Button, Text } = DESK_LIB["@mantine/core"];')

    def test_leading_bom_is_ignored(self):
        out = rewrite('﻿import { Button } from "@mantine/core";\n' + PAGE)
        self.assertEqual(out.problems, [])
        self.assertEqual(out.body.splitlines()[0], 'const { Button } = DESK_LIB["@mantine/core"];')

    def test_import_after_statement(self):
        self.assertProblem(rewrite('const x = 1;\nimport { Button } from "@mantine/core";\n' + PAGE), 2, "import")

    def test_script_close_in_string(self):
        self.assertProblem(rewrite(PAGE + 'const s = "</SCRIPT>";\n'), 2, "</script")

    def test_comment_open_in_jsx_text(self):
        self.assertProblem(rewrite(PAGE + "const s = <p>a <!-- b</p>;\n"), 2, "<!--")


class PageDir:
    def __init__(self, test, name, text):
        self.tmp = tempfile.mkdtemp()
        test.addCleanup(shutil.rmtree, self.tmp)
        self.dir = os.path.join(self.tmp, "board")
        os.mkdir(self.dir)
        with open(os.path.join(self.dir, name), "w", encoding="utf-8") as fh:
            fh.write(text)


PROLOGUE = "const __h = DESK_LIB.react.createElement, __F = DESK_LIB.react.Fragment;"


class CompileTests(unittest.TestCase):
    def compile(self, name, text):
        return desk_raw.compile_page(PageDir(self, name, text).dir, EXPORTS)

    @unittest.skipUnless(HAVE_NODE, "node is not on PATH")
    def test_jsx_fragment_and_element(self):
        out = self.compile("board.jsx", 'import { Button } from "@mantine/core";\n'
                           "export default function Page() { return <><Button onClick={() => 1}>Go</Button></>; }\n")
        self.assertEqual(out.problems, [])
        self.assertTrue(out.js.startswith(PROLOGUE))
        self.assertIn("__h(__F, null", out.js)
        self.assertIn("__h(Button", out.js)
        self.assertTrue(out.js.rstrip().endswith("return Page;"))
        self.assertEqual(out.specifiers, ["@mantine/core"])

    @unittest.skipUnless(HAVE_NODE, "node is not on PATH")
    def test_apostrophe_compiles(self):
        out = self.compile("board.jsx", 'import { Text } from "@mantine/core";\n'
                           "export default function () { return <Text>Don't</Text>; }\n")
        self.assertEqual(out.problems, [])
        self.assertIn("Don't", out.js)
        self.assertTrue(out.js.rstrip().endswith("return __Page;"))

    @unittest.skipUnless(HAVE_NODE, "node is not on PATH")
    def test_syntax_error_line(self):
        out = self.compile("board.jsx", 'import { Text } from "@mantine/core";\n\n'
                           "export default function Page() { return <Text>; }\n")
        self.assertIsNone(out.js)
        self.assertTrue(out.problems)
        self.assertTrue(out.problems[0].startswith("board.jsx:3: "), out.problems)

    @unittest.skipUnless(HAVE_NODE, "node is not on PATH")
    def test_entity_comment_open_refused_after_transform(self):
        out = self.compile("board.jsx", "export default function Page() { return <p>&lt;!-- x</p>; }\n")
        self.assertIsNone(out.js)
        self.assertTrue(any("<!--" in p and p.startswith("board.jsx") for p in out.problems), out.problems)

    def test_rewrite_problem_skips_transform(self):
        out = self.compile("board.jsx", 'import { map } from "lodash";\n' + PAGE)
        self.assertIsNone(out.js)
        self.assertTrue(out.problems[0].startswith("board.jsx:1: "))

    def test_bom_file_rewrites_imports(self):
        tmp = PageDir(self, "board.js", "")
        with open(os.path.join(tmp.dir, "board.js"), "w", encoding="utf-8-sig") as fh:
            fh.write('import { Button } from "@mantine/core";\n' + PAGE)
        out = desk_raw.compile_page(tmp.dir, EXPORTS)
        self.assertEqual(out.problems, [])
        self.assertNotIn("import", out.js)
        self.assertNotIn("﻿", out.js)

    def test_no_node_jsx_refused(self):
        with mock.patch.object(desk_raw.shutil, "which", return_value=None):
            out = self.compile("board.jsx", PAGE)
        self.assertIsNone(out.js)
        self.assertEqual(out.problems, [
            "board.jsx: node is not on PATH, so JSX cannot be compiled. Install a current Node.js LTS, or write the page"
            " as board.js with React.createElement (see references/desk-raw-pages.md)"])

    def test_no_node_js_builds(self):
        source = ('import { createElement as h } from "react";\nimport { Button } from "@mantine/core";\n'
                  'export default function Page() { return h(Button, null, "Go"); }\n')
        with mock.patch.object(desk_raw.shutil, "which", return_value=None):
            out = self.compile("board.js", source)
        self.assertEqual(out.problems, [])
        self.assertEqual(out.js, PROLOGUE + 'const { createElement: h } = DESK_LIB["react"];\n'
                         'const { Button } = DESK_LIB["@mantine/core"];\n'
                         'function Page() { return h(Button, null, "Go"); }\n'
                         "return Page;\n")
        self.assertEqual(out.specifiers, ["@mantine/core", "react"])

    def test_transformer_id(self):
        self.assertEqual(desk_raw.TRANSFORMER_ID, "sucrase-3.35.1-jsx-classic")
        self.assertTrue(os.path.isfile(desk_raw.TRANSFORMER))

    def test_transformer_bytes_are_pinned_to_the_id(self):
        # A rebuilt jsx_transform.cjs changes the code every approved page runs, so it must bump TRANSFORMER_ID
        # (re-asking approval) and record its new sha in desk_raw.TRANSFORMER_SHA256.
        self.assertIn(desk_raw.TRANSFORMER_ID, desk_raw.TRANSFORMER_SHA256)
        with open(desk_raw.TRANSFORMER, "rb") as fh:
            actual = hashlib.sha256(fh.read()).hexdigest()
        self.assertEqual(actual, desk_raw.TRANSFORMER_SHA256[desk_raw.TRANSFORMER_ID],
                         "vendor/jsx_transform.cjs changed: bump TRANSFORMER_ID and update TRANSFORMER_SHA256")

    def test_reserved_prologue_names_refused(self):
        for src in ("const __h = 1;\nexport default function Page() { return null; }\n",
                    "export default function Page() { const __F = 2; return null; }\n"):
            out = self.compile("board.js", src)
            self.assertIsNone(out.js)
            self.assertEqual(len(out.problems), 1, out.problems)
            self.assertIn("reserved for the page prologue", out.problems[0])
            self.assertTrue(out.problems[0].startswith("board.js:"), out.problems)
        ok = self.compile("board.js", "export default function Page() { const __hx = 1, a__h = 2; return null; }\n")
        self.assertEqual(ok.problems, [])

    def test_non_json_node_output_reports_exit_code_and_stderr(self):
        done = mock.Mock(stdout="", stderr="warn\nSyntaxError: Unexpected token '?'\n", returncode=1)
        with mock.patch.object(desk_raw.shutil, "which", return_value="/usr/bin/node"), \
                mock.patch.object(desk_raw.subprocess, "run", return_value=done):
            out = self.compile("board.jsx", PAGE)
        self.assertIsNone(out.js)
        self.assertEqual(len(out.problems), 1)
        self.assertIn("node exit code 1", out.problems[0])
        self.assertIn("stderr: SyntaxError: Unexpected token '?'", out.problems[0])


if __name__ == "__main__":
    unittest.main()
