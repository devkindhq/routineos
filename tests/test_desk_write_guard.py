"""The guarded writer for a routine's Desk page (bundle_desk.write_guarded) and the two CLI writes that use it:
`bundle --routine R` (dashboard/index.html) and `bundle --routine R --split` (dashboard/artifact/).

A write never follows a symlink at the dashboard folder, the artifact folder or a target file, never leaves the
output folder, and never deletes outside it. These are the split-folder safety checks from the old split build,
run against a synthetic page so they need no build."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "skills", "routineos", "scripts"))

import bundle_desk  # noqa: E402
import routineos  # noqa: E402

FILES = {"index.html": "<!doctype html><p>desk</p>\n", "files.json": json.dumps(["index.html"]) + "\n"}
OLD_MANIFEST = {"files": [{"path": "index.html"}, {"path": "core.js"}, {"path": "pages/today.js"},
                          {"path": "pages/browse.js"}]}


def run_cli(*argv):
    out, err = io.StringIO(), io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        code = routineos.main(list(argv))
    return code, out.getvalue(), err.getvalue()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.routine = os.path.join(self.tmp, "routine")
        os.makedirs(self.routine)
        self.dash = os.path.join(self.routine, "dashboard")
        self.out = os.path.join(self.dash, "artifact")
        self.outside = os.path.join(self.tmp, "elsewhere")
        os.makedirs(self.outside)

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def victim(self, name="victim.txt"):
        path = os.path.join(self.tmp, name)
        write(path, "keep")
        return path

    def assert_kept(self, path):
        self.assertFalse(os.path.islink(path))
        self.assertEqual(read(path), "keep")

    def split(self, files=FILES):
        with contextlib.redirect_stdout(io.StringIO()):
            return bundle_desk.write_guarded(self.routine, self.out, files, manifest=True)

    def old_layout(self):
        write(os.path.join(self.out, "index.html"), "old")
        write(os.path.join(self.out, "core.js"), "old")
        write(os.path.join(self.out, "pages", "today.js"), "old")
        write(os.path.join(self.out, "pages", "browse.js"), "old")
        write(os.path.join(self.out, "files.json"), json.dumps(OLD_MANIFEST))

    def old_manifest_with(self, *paths):
        write(os.path.join(self.out, "files.json"),
              json.dumps({"files": OLD_MANIFEST["files"] + [{"path": p} for p in paths]}))


class WriterTests(Base):
    def test_writes_the_files_into_a_fresh_folder(self):
        self.assertEqual(sorted(self.split()), ["files.json", "index.html"])
        self.assertEqual(sorted(os.listdir(self.out)), ["files.json", "index.html"])
        self.assertEqual(read(os.path.join(self.out, "index.html")), FILES["index.html"])

    def test_rerun_overwrites_its_own_files(self):
        self.split()
        self.split({"index.html": "new", "files.json": FILES["files.json"]})
        self.assertEqual(read(os.path.join(self.out, "index.html")), "new")

    def test_refuses_a_symlinked_dashboard_folder(self):
        os.symlink(self.outside, self.dash)
        with self.assertRaisesRegex(bundle_desk.BundleError, "symlink"):
            self.split()
        self.assertEqual(os.listdir(self.outside), [])

    def test_refuses_a_symlinked_artifact_folder(self):
        os.makedirs(self.dash)
        os.symlink(self.outside, self.out)
        with self.assertRaisesRegex(bundle_desk.BundleError, "symlink"):
            self.split()
        self.assertEqual(os.listdir(self.outside), [])

    def test_refuses_to_write_through_a_symlinked_file(self):
        for name in ("files.json", "index.html"):
            with self.subTest(name=name):
                shutil.rmtree(self.dash, ignore_errors=True)
                os.makedirs(self.out)
                victim = self.victim()
                os.symlink(victim, os.path.join(self.out, name))
                with self.assertRaisesRegex(bundle_desk.BundleError, "symlink"):
                    self.split()
                self.assert_kept(victim)

    def test_refuses_a_target_in_a_symlinked_subfolder(self):
        os.makedirs(self.out)
        os.symlink(self.outside, os.path.join(self.out, "sub"))
        with self.assertRaises(bundle_desk.BundleError):
            bundle_desk.write_guarded(self.routine, self.out, {"sub/x.html": "x"})
        self.assertEqual(os.listdir(self.outside), [])

    def test_refuses_an_output_folder_outside_the_routine(self):
        with self.assertRaisesRegex(bundle_desk.BundleError, "outside"):
            bundle_desk.write_guarded(self.routine, os.path.join(self.routine, "..", "elsewhere"), FILES)
        self.assertEqual(os.listdir(self.outside), [])

    def test_refuses_unsafe_relative_paths(self):
        for bad in ("/abs.html", "..\\x.html", "a\\b.html", "C:x.html", "C:/x.html", "", ".", "..", "../x.html",
                    "./x.html", "a//b.html", "x\x00y", "x\ny", "x\x7fy"):
            with self.subTest(path=bad), self.assertRaisesRegex(bundle_desk.BundleError, "unsafe path|outside"):
                bundle_desk.write_guarded(self.routine, self.out, {bad: "x"})
        self.assertEqual(sorted(os.listdir(self.tmp)), ["elsewhere", "routine"])
        self.assertEqual(os.listdir(self.outside), [])

    def test_nothing_is_written_when_one_target_is_refused(self):
        os.makedirs(self.out)
        os.symlink(self.victim(), os.path.join(self.out, "files.json"))
        with self.assertRaises(bundle_desk.BundleError):
            self.split()
        self.assertFalse(os.path.exists(os.path.join(self.out, "index.html")))

    def test_refuses_a_nonempty_folder_without_files_json(self):
        write(os.path.join(self.out, "notes.txt"), "mine")
        with self.assertRaisesRegex(bundle_desk.BundleError, r"refusing to write into non-empty .* without files\.json"):
            self.split()
        self.assertEqual(os.listdir(self.out), ["notes.txt"])

    def test_old_split_files_are_removed(self):
        self.old_layout()
        self.split()
        self.assertEqual(sorted(os.listdir(self.out)), ["files.json", "index.html"])
        self.assertEqual(json.loads(read(os.path.join(self.out, "files.json"))), ["index.html"])

    def test_unlisted_files_are_kept_and_named(self):
        self.old_layout()
        write(os.path.join(self.out, "keep.txt"), "mine")
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            self.split()
        self.assertEqual(read(os.path.join(self.out, "keep.txt")), "mine")
        self.assertIn("keep.txt", err.getvalue())
        self.assertFalse(os.path.exists(os.path.join(self.out, "core.js")))

    def test_manifest_paths_outside_the_folder_are_ignored(self):
        self.old_layout()
        victim = self.victim()
        self.old_manifest_with("../victim.txt")
        self.split()
        self.assert_kept(victim)

    def test_unsafe_manifest_paths_are_skipped_and_reported(self):
        victim = self.victim()
        for bad in ("..\\victim.txt", "a\\b.js", "C:victim.txt", "C:/victim.txt", "./victim.txt", "pages/./x.js",
                    "pages//x.js", "x\x00y", "x\ny", "/abs/victim.txt"):
            with self.subTest(path=bad):
                self.old_layout()
                self.old_manifest_with(bad)
                err = io.StringIO()
                with contextlib.redirect_stderr(err):
                    self.split()
                self.assertIn("skipping unsafe manifest path", err.getvalue())
                self.assertIn(repr(bad), err.getvalue())
                self.assert_kept(victim)

    def test_does_not_delete_through_a_symlinked_file(self):
        self.old_layout()
        victim = self.victim()
        link = os.path.join(self.out, "pages", "gone.js")
        os.symlink(victim, link)
        self.old_manifest_with("pages/gone.js")
        with contextlib.redirect_stderr(io.StringIO()):
            self.split()
        self.assert_kept(victim)
        self.assertTrue(os.path.islink(link))

    def test_does_not_delete_through_a_symlinked_directory(self):
        self.old_layout()
        victim = self.victim()
        os.symlink(self.tmp, os.path.join(self.out, "linked"))
        self.old_manifest_with("linked/victim.txt")
        with contextlib.redirect_stderr(io.StringIO()):
            self.split()
        self.assert_kept(victim)

    def test_a_symlinked_manifest_is_not_read(self):
        os.makedirs(self.out)
        outside_manifest = os.path.join(self.tmp, "manifest.json")
        write(outside_manifest, json.dumps(OLD_MANIFEST))
        os.symlink(outside_manifest, os.path.join(self.out, "files.json"))
        with self.assertRaises(bundle_desk.BundleError):
            self.split()
        self.assertEqual(read(outside_manifest), json.dumps(OLD_MANIFEST))


class CliTests(Base):
    def setUp(self):
        super().setUp()
        shutil.rmtree(self.routine)
        code, out, err = run_cli("new", "watch", "--from-template", "jobs-watch", "--dir", self.routine)
        self.assertEqual(code, 0, out + err)
        self.page = os.path.join(self.dash, "index.html")

    def test_split_refuses_a_symlinked_artifact_folder(self):
        os.symlink(self.outside, self.out)
        code, out, err = run_cli("bundle", "--routine", self.routine, "--split")
        self.assertNotEqual(code, 0)
        self.assertIn("symlink", out + err)
        self.assertEqual(os.listdir(self.outside), [])

    def test_split_refuses_a_symlinked_dashboard_folder(self):
        shutil.rmtree(self.dash)
        os.symlink(self.outside, self.dash)
        code, out, err = run_cli("bundle", "--routine", self.routine, "--split")
        self.assertNotEqual(code, 0)
        self.assertEqual(os.listdir(self.outside), [])

    def test_split_refuses_a_symlinked_files_json(self):
        os.makedirs(self.out)
        victim = self.victim()
        os.symlink(victim, os.path.join(self.out, "files.json"))
        code, out, err = run_cli("bundle", "--routine", self.routine, "--split")
        self.assertNotEqual(code, 0)
        self.assert_kept(victim)

    def test_split_after_an_old_split_build_removes_its_files(self):
        self.old_layout()
        code, out, err = run_cli("bundle", "--routine", self.routine, "--split")
        self.assertEqual(code, 0, out + err)
        self.assertEqual(sorted(os.listdir(self.out)), ["files.json", "index.html"])
        self.assertIn("Split mode is gone; wrote one file.", out)

    def test_bundle_refuses_a_symlinked_dashboard_folder(self):
        shutil.rmtree(self.dash)
        os.symlink(self.outside, self.dash)
        code, out, err = run_cli("bundle", "--routine", self.routine)
        self.assertNotEqual(code, 0)
        self.assertIn("symlink", out + err)
        self.assertEqual(os.listdir(self.outside), [])

    def test_bundle_refuses_a_symlinked_index_html(self):
        os.remove(self.page)
        victim = self.victim()
        os.symlink(victim, self.page)
        code, out, err = run_cli("bundle", "--routine", self.routine)
        self.assertNotEqual(code, 0)
        self.assert_kept(victim)
        self.assertTrue(os.path.islink(self.page))

    def test_bundle_keeps_other_dashboard_files(self):
        write(os.path.join(self.dash, "notes.md"), "mine")
        code, out, err = run_cli("bundle", "--routine", self.routine)
        self.assertEqual(code, 0, out + err)
        self.assertEqual(read(os.path.join(self.dash, "notes.md")), "mine")
        self.assertEqual(read(self.page), routineos.desk_page(routineos._workspace_name(self.routine),
                                                             routine_dir=self.routine))


if __name__ == "__main__":
    unittest.main()
