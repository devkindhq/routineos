# Platform facts

The facts moved to the capability registry, which is the single source.

- Registry file: `registry/capabilities.toml` (each record has an id, claim, status, source and checked date; statuses are unverified, docs-stated, pilot-verified, conflict, broken).
- List it: `python3 scripts/routineos.py platform list` (add `--status unverified` to see what is not checked).
- Check an app's dependencies: `python3 scripts/routineos.py platform check <app dir>`.
- Refresh procedure: [platform-refresh.md](platform-refresh.md).

Tags used when speaking to the person: pilot (checked by a real run), docs (read in official docs), unverified (not checked, do not promise), call (the author's judgement).

Always search the live docs when a decision depends on a current limit. The registry holds only core caveats and may be stale. Do not copy registry values into other files; read the registry.
