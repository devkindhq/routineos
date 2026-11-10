import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "skills", "routineos", "scripts"))
import registry  # noqa: E402

REQUIRED_IDS = {
    "run-writes-artifact-db", "remotetrigger-manage-tasks", "remotetrigger-create-fields",
    "script-writes-store", "run-cannot-fire-routines", "api-trigger-fire", "api-trigger-limits", "repo-script-runs", "approval-email-slack",
    "push-one-way", "push-reply-path", "in-app-approval-button", "teams-approval", "network-secrets",
    "env-vars-readable", "environments-ui-only", "connectors-account-level", "sandbox-allowlist",
    "max-run-time", "schedule-limits", "run-vm-spec", "auto-pause-on-cost", "republish-from-run-asks",
    "artifact-db-limits-vs-no-backend", "cloudflare-supabase-modal-daytona-reach",
    "connector-credentials-in-transcript", "repo-skills-carry-over", "account-skills-sync",
    "skill-upload-frontmatter-allowlist", "repo-plugins-not-installed-in-cloud", "repo-less-routine",
    "thin-prompt-plus-skill", "fire-payload-untrusted",
    "environment-settings-not-readable-via-api", "default-environment-shared", "default-environment-network",
    "connector-traffic-bypasses-sandbox-network", "webfetch-limited-network", "setup-script-rules",
    "repo-delivery", "remotetrigger-body-shape", "run-finds-store-by-listing", "run-uses-unlisted-send",
    "run-invents-timestamps", "run-obeys-in-session-cap-override", "run-mints-run-id-off-clock",
    "python-isolated-ignores-cwd", "run-merges-status-doc", "seek-bot-challenge-via-browser-connector",
    "run-reads-shared-artifact-db", "run-writes-shared-artifact-db",
    "desk-db-path-rules",
    "user-can-data-write-commenter",
    "desk-comments-path-rule",
    "desk-native-comment-composer",
}


def rec(**kw):
    base = {"id": "x", "claim": "a claim", "status": "unverified"}
    base.update(kw)
    return base


class ValidateTests(unittest.TestCase):
    def test_validate_rejects_unknown_status(self):
        problems = registry.validate([rec(status="maybe")])
        self.assertTrue(any("status" in p and "maybe" in p for p in problems))

    def test_pilot_verified_requires_tested_field(self):
        self.assertTrue(registry.validate([rec(status="pilot-verified")]))
        self.assertEqual(registry.validate([rec(status="pilot-verified", tested="2026-10-28 pilot")]), [])

    def test_docs_stated_requires_source_and_checked(self):
        self.assertTrue(registry.validate([rec(status="docs-stated", source=["u"])]))
        self.assertTrue(registry.validate([rec(status="docs-stated", checked="2026-10-29")]))
        self.assertEqual(registry.validate([rec(status="docs-stated", source=["u"], checked="2026-10-29")]), [])

    def test_conflict_requires_both_tested_and_docs(self):
        self.assertTrue(registry.validate([rec(status="conflict", tested="t")]))
        self.assertTrue(registry.validate([rec(status="conflict", docs="d")]))
        self.assertEqual(registry.validate([rec(status="conflict", tested="t", docs="d")]), [])

    def test_unverified_may_carry_lead_and_needs_no_tested(self):
        self.assertEqual(registry.validate([rec(lead="owner-reported, not checked")]), [])

    def test_duplicate_ids_rejected(self):
        problems = registry.validate([rec(), rec()])
        self.assertTrue(any("duplicate" in p for p in problems))

    def test_missing_id_or_claim_reported(self):
        self.assertTrue(registry.validate([{"status": "unverified", "claim": "c"}]))
        self.assertTrue(registry.validate([{"status": "unverified", "id": "i"}]))


class StaleTests(unittest.TestCase):
    def test_stale_flags_old_and_missing_checked(self):
        recs = [rec(id="old", checked="2026-10-10"), rec(id="fresh", checked="2026-10-20"), rec(id="none")]
        self.assertEqual(sorted(registry.stale(recs, "2026-10-29")), ["none", "old"])

    def test_by_id(self):
        self.assertEqual(registry.by_id([rec(id="a"), rec(id="b")])["b"]["id"], "b")


class LoadTests(unittest.TestCase):
    def test_load_missing_and_malformed_give_one_line_error(self):
        with self.assertRaises(registry.RegistryError) as cm:
            registry.load("/nonexistent/caps.toml")
        self.assertNotIn("\n", str(cm.exception))
        with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False) as fh:
            fh.write("[[capability]\nid = ")
        try:
            with self.assertRaises(registry.RegistryError) as cm:
                registry.load(fh.name)
            self.assertNotIn("\n", str(cm.exception))
        finally:
            os.unlink(fh.name)


class SeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.records = registry.load(registry.DEFAULT_PATH)

    def test_seed_is_valid(self):
        self.assertEqual(registry.validate(self.records), [])

    def test_seed_contains_required_ids(self):
        self.assertEqual({r["id"] for r in self.records}, REQUIRED_IDS)

    def test_owner_reported_items_are_not_verified(self):
        ids = registry.by_id(self.records)
        for i in ("script-writes-store", "remotetrigger-create-fields"):
            self.assertEqual(ids[i]["status"], "unverified")
            self.assertEqual(ids[i]["lead"], "owner-reported, not re-tested in this project")

    def test_delivery_records_have_expected_tags(self):
        ids = registry.by_id(self.records)
        for i in ("repo-skills-carry-over", "account-skills-sync", "skill-upload-frontmatter-allowlist",
                  "repo-plugins-not-installed-in-cloud", "fire-payload-untrusted"):
            self.assertEqual(ids[i]["status"], "docs-stated", i)
            self.assertTrue(all(u.startswith("https://code.claude.com/docs/en/") for u in ids[i]["source"]), i)
            self.assertEqual(ids[i]["checked"], "2026-10-29")
        self.assertEqual(ids["thin-prompt-plus-skill"]["status"], "unverified")
        self.assertTrue(ids["thin-prompt-plus-skill"]["lead"] and ids["thin-prompt-plus-skill"]["test"])
        self.assertEqual(ids["repo-less-routine"]["status"], "pilot-verified")
        self.assertIn("2026-10-28", ids["repo-less-routine"]["tested"])

    def test_environment_and_pilot_records_have_expected_tags(self):
        ids = registry.by_id(self.records)
        for i in ("connector-traffic-bypasses-sandbox-network", "setup-script-rules"):
            self.assertEqual(ids[i]["status"], "docs-stated", i)
            self.assertIn("https://code.claude.com/docs/en/cloud-environments", ids[i]["source"], i)
            self.assertRegex(ids[i]["docs"], r"\(summary: https://docs\.routineos\.org/infrastructure/[a-z-]+(#[a-z-]+)?\)$", i)
        self.assertEqual(ids["webfetch-limited-network"]["status"], "unverified")
        self.assertIn("Probe", ids["webfetch-limited-network"]["test"])
        self.assertEqual(ids["default-environment-network"]["status"], "conflict")
        for i in ("environment-settings-not-readable-via-api", "default-environment-shared", "repo-delivery",
                  "remotetrigger-body-shape", "run-finds-store-by-listing", "run-uses-unlisted-send",
                  "run-invents-timestamps", "run-obeys-in-session-cap-override", "run-mints-run-id-off-clock",
                  "python-isolated-ignores-cwd", "run-merges-status-doc",
                  "seek-bot-challenge-via-browser-connector"):
            self.assertEqual(ids[i]["status"], "pilot-verified", i)
            self.assertTrue(any(u.startswith("pilot:") for u in ids[i]["source"]), i)
        self.assertEqual(registry.validate(self.records), [])

    def test_join_pilot_records_are_tested(self):
        ids = registry.by_id(self.records)
        for i in ("run-reads-shared-artifact-db", "run-writes-shared-artifact-db"):
            self.assertIn(ids[i]["status"], ("pilot-verified", "broken"), i)
            self.assertRegex(ids[i]["tested"], r"^2026-\d\d-\d\d, join pilot", i)
            self.assertTrue(any(u.startswith("pilot:join-cross-account-") for u in ids[i]["source"]), i)


if __name__ == "__main__":
    unittest.main()
