# Runtimes

The default runtime is Claude's cloud environment for routines. Other sandboxes are optional adapters for work the default cannot do (long jobs, heavy installs, blocked hosts). All reachability claims are unverified: no pilot ran a call from a routine to any of them.

## Daytona

Per its docs (https://www.daytona.io/docs, fetched 2026-10-28): a platform for running AI-generated code in isolated sandboxes, with SDKs for Python, TypeScript, Ruby, Go and Java, an API and a CLI. Startup and persistence figures are the vendor's own claims. From a routine: [unverified], the network allowlist may block it.

## Modal

Per its docs (https://modal.com/docs/guide, fetched 2026-10-28): a cloud platform for AI workloads with sandboxed code execution, billed by second. Scheduled functions and web endpoints were not covered by the page read, so they are [unverified] here. From a routine: [unverified].

## Using one

1. Test the host from a run first; the sandbox network behaves like an allowlist.
2. Credentials never go in the db or prompt. Prefer a connector or an endpoint you own.
3. Keep the contract: the remote job returns results to the artifact db through a path that carries a version, and state is written after the report.
4. Mark the routine's README with the runtime and the date it was last tested.
