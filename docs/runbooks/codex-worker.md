# Owner Alpha Codex Worker Runbook

Status: Task 7 operational runbook. Automated Phase 2 only. Manual Live Smoke is intentionally not completed by this document.

## 1. Architecture

Owner Alpha keeps the existing AI boundary:

```text
LINE / Web
  -> durable ai_jobs queue
  -> private Node worker
  -> @fitcoach/ai AIProvider / AIRouter
  -> CodexProvider
  -> official @openai/codex-sdk
  -> authenticated Codex CLI session from the owner's ChatGPT account
```

The worker is private and must not be exposed as a public Codex endpoint. Feature code must continue to call `AIProvider`/`AIRouter`; it must not import the Codex SDK directly.

Task 6 remains the source of truth for durable queue ownership, quota, timeout, retry and recovery policy. Task 7 only supplies the concrete Owner Alpha provider/runtime.

## 2. Authentication model

Owner Alpha uses the authenticated ChatGPT/Codex session, not an OpenAI API key.

Supported operational commands from the official Codex CLI:

```bash
codex login
codex login status
codex login --device-auth
codex logout
```

- `codex login` starts the normal ChatGPT sign-in flow.
- `codex login status` is the required preflight check before any Manual Live Smoke or live worker start.
- `codex login --device-auth` is the preferred headless/device-code flow when an interactive browser flow is not practical.
- `codex logout` removes the stored Codex authentication session when rotating or intentionally disconnecting the worker.

Do not use `codex login --with-api-key` for Owner Alpha. API-key authentication is a different billing/auth path and is outside this phase.

Official references:
- OpenAI Codex repository: `https://github.com/openai/codex`
- OpenAI Codex / ChatGPT plan guidance: `https://help.openai.com/en/articles/11369540`

## 3. Credential and session protection

- Never commit, copy, paste, print or attach Codex credential/session contents to Git, PRs, tickets, chat, CI logs or application logs.
- Treat the entire configured `CODEX_HOME` credential/session store as sensitive.
- Do not place the credential/session store inside the repository or an isolated job workspace.
- Do not add authentication files to test fixtures.
- Tests must use injected fake runtimes/clients and synthetic data only.
- The worker runtime must not pass `OPENAI_API_KEY`, `CODEX_API_KEY`, generic tokens, cookies, database credentials or unrelated secrets into the Codex child process.

The official runtime adapter constructs the Codex client with an explicit environment allowlist. Current allowed runtime variables are limited to process/runtime location and locale variables needed for the CLI, including `PATH`, `HOME`, `CODEX_HOME`, temporary-directory variables, locale variables and required Windows process-path variables. Adding a new allowlisted variable requires review because it expands the credential exposure surface.

## 4. Workspace isolation

Each AI execution gets a unique provider-owned workspace named with the `fitcoach-codex-job-` prefix beneath the configured workspace root.

Rules:
- Never use the repository root as a job workspace.
- Food images are materialized into the current job workspace before being passed to the SDK.
- A materialized image path outside the owned job workspace is rejected before Codex runs.
- Cleanup is attempted after both success and failure.
- Cleanup validates that the target is a direct child of the configured root and carries the provider-owned prefix before recursive removal.
- Cleanup must never remove the workspace root, credential/session directories or unrelated sibling paths.
- If execution failed and cleanup also fails, the original sanitized provider error is preserved.
- If execution succeeded but cleanup fails, the provider returns sanitized retryable `provider_cleanup_failure`; raw filesystem paths/errors are not surfaced to feature code.

A cleanup failure means the private worker host requires operator attention because a temporary job directory may remain. Inspect and remove only verified `fitcoach-codex-job-*` directories under the configured workspace root; never bulk-delete parent directories.

## 5. Codex sandbox and network posture

Every Owner Alpha Codex turn is started with:

```text
sandboxMode = read-only
networkAccessEnabled = false
webSearchMode = disabled
approvalPolicy = never
skipGitRepoCheck = true
```

`workingDirectory` is the isolated job workspace, and structured `outputSchema` plus the worker-owned `AbortSignal` are forwarded through the official SDK.

Food image inputs use the official local image shape and local paths only. Do not convert private storage references into public URLs for Codex.

## 6. Model configuration

Model IDs are configuration, not feature constants.

Initial Source-of-Truth routing:
- Luna: food text parsing, clear workout parsing, short coach reply.
- Terra: food image analysis, daily report and weekly report synthesis.

Ambiguous workout is listed in the product Source of Truth as Terra work, but the current `ParseWorkoutInput` contract has no explicit ambiguity/complexity signal. Task 7 must not invent a text heuristic. Until the input contract is refined, workout parsing uses the configured Luna model and ambiguous-workout routing remains a known limitation.

If a configured model is unavailable to the authenticated Codex workspace, change the configured model ID while preserving the same provider output schemas. Do not hardcode a fallback in feature code.

## 7. Task 6 worker policy remains unchanged

Owner Alpha worker policy is still owned by Task 6:
- 50 new AI jobs per Bangkok day.
- Warning at 40 jobs.
- Concurrency 1.
- 90-second execution timeout.
- Maximum 3 provider attempts total (initial attempt plus at most 2 retries).
- Retry only temporary/network-class failures.
- Durable PostgreSQL lease, stale-owner fencing, restart recovery and quota-count-once semantics remain unchanged.

Do not move quota, retry, timeout or lease ownership into `CodexProvider`.

## 8. Known official SDK limitation

The pinned runtime package for Task 7 is:

```text
@openai/codex-sdk = 0.150.1
```

The current public `thread.run()` surface can report turn failures as generic `Error` values and does not provide a stable public typed discriminator that reliably separates authentication/session failures from transient runtime failures.

Therefore:
- The adapter must not parse human-readable error strings to guess auth state.
- Abort is classified explicitly when the `AbortSignal`/`AbortError` proves it.
- Other generic SDK turn failures remain sanitized temporary runtime failures.
- Authentication is verified separately by the manual preflight `codex login status` before starting a live Owner Alpha worker.
- Typed auth/config mapping is only used when a runtime layer can prove that classification structurally.

## 9. Manual preflight before a live worker

Manual Live Smoke is a later phase and must not run during automated Phase 2 verification.

Before the first live smoke or after any session problem:
1. Stop the worker process so no new Codex jobs begin.
2. Run `codex login status` on the private worker host under the same OS user and `CODEX_HOME` that will run the worker.
3. If not authenticated, use `codex login` or `codex login --device-auth` as appropriate.
4. Run `codex login status` again and require a successful status before starting the worker.
5. Confirm the configured Luna/Terra model IDs and private workspace root.
6. Confirm no OpenAI API key is configured as an Owner Alpha fallback.
7. Start the private worker only after the preflight succeeds.

Never print credential files while diagnosing authentication.

## 10. How to stop the worker safely

Use the normal process-manager stop action, Ctrl+C, or a graceful termination signal such as SIGTERM for the private Node worker.

Do not delete queue rows to stop work. Durable jobs and leases are PostgreSQL state; an interrupted job is recovered by the Task 6 lease/retry logic after the relevant lease/retry window. Avoid force-killing the process unless graceful stop is impossible.

## 11. Recovery when the ChatGPT/Codex session expires

1. Stop the worker.
2. Run `codex login status`.
3. Re-authenticate with `codex login` or `codex login --device-auth` without copying session material into the repo/logs.
4. Re-run `codex login status`.
5. Start the worker again only after status is healthy.
6. Allow the durable queue to recover pending/expired-lease work naturally; do not manually duplicate jobs.
7. If repeated generic SDK failures continue despite healthy login status, keep the worker stopped and investigate configuration/model availability rather than converting the worker to API-key auth.

## 12. Manual Live Smoke — next phase only

Do not mark these complete during automated Phase 2. Use only synthetic/non-sensitive fixtures and record no credential/session content.

- [ ] Food text: one Thai text meal; verify structured JSON, Luna routing and schema validation.
- [ ] Food image: one synthetic/non-sensitive local food image; verify Terra routing, local-image materialization and workspace cleanup.
- [ ] Strength workout: one clear text workout such as `Bench press 40kg 10x3 RPE8`; verify Luna routing and structured workout output.
- [ ] Coach question: one short synthetic question using backend-provided facts; verify Luna routing and structured coach reply.

For every smoke case, verify the worker timeout/lease remains Task 6-owned and that no raw prompt credential, auth cache, session token or private storage credential appears in logs.

## 13. Environment boundary

This runbook does not authorize Production Supabase access. Automated Task 7 verification uses normal CI plus disposable DB Integration only. Production Supabase remains out of scope until separately approved.
