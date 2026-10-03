# Agent Bridge

Internal FDE demo tool: makes two ElevenLabs Conversational AI agents talk to
each other over real WebSocket + audio, so you can demo a "Callee" agent
(e.g. a multilingual receptionist) being called by a "Caller" agent that
plays a scripted customer, in any language. Built from two internal spec
documents, `spec-agent-bridge-demo.md` and `spec-agent-appelant.md` --
historical design references, not part of this repository (hence their
mentions elsewhere in this README point outside it, not to a path you'll
find here).

**Stack: Flask (Python) backend + a plain browser-loaded React frontend.**
No Node build step -- the frontend is `static/js/**/*.js(x)` loaded directly
by the browser, with JSX transpiled at runtime by Babel standalone (same
pattern as this team's other Flask + React projects). An earlier Electron
prototype is kept for reference in `_legacy-electron-version/` (not run,
not maintained).

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in at least one account
flask --app app run --debug
```

Open http://127.0.0.1:5000. On first launch:

1. Go to **Settings → Agents**, add a caller agent and a callee agent, pick
   their account and paste their `agent_id` (or use "List agents on this
   account" once you've selected an account).
2. Go to **Settings → Scenarios**, click **Load 3 examples** to get the
   hotel (ja) / clinic (zh) / e-commerce (es) demo scenarios, or build your
   own.
3. Optionally bundle a caller + callee + scenario into a **Preset** in
   **Settings → Presets** (one scenario = single demo preset, several =
   a batch preset that runs them in parallel from Session).
4. Go to **Session**, pick your agents and scenario (or a preset), click
   **Launch**. Review the pre-flight checklist; fix anything marked ❌
   before launching.
5. To compare the callee agent's latency across TTS/LLM configurations
   instead of running a single live demo, build a **Benchmark** in
   **Settings → Benchmarks** (pick TTS model families and/or LLMs to sweep,
   cross-product of both), then select it from the benchmark dropdown on
   **Session** and launch it. It snapshots the callee's current config,
   runs every scenario against every variant, restores the original config
   afterwards, and shows per-node ASR/LLM/TTS latency plus node-coverage
   tables when done. Benchmarks that don't vary TTS offer a **Text only**
   launch option, which skips the audio pipeline entirely for a much faster
   pass.
6. Every session, batch, and benchmark run is saved under **History**. Its
   **Analytics** tab re-harmonizes all of that history for one callee agent
   by (LLM, TTS) config -- or by LLM alone, with the "Breakdown by TTS
   model" toggle off -- independent of which feature originally produced
   the data.

### Running it for real (beyond `flask run`)

```bash
gunicorn -w 1 -b 127.0.0.1:5000 app:app
```

Keep `-w 1` (a single worker): this is a single-user local tool, and the
account list is cached per-process from `.env` at first use.

## Why a CDN, and why the CSP is looser than a typical app

The frontend has no build step, so React, ReactDOM and Babel standalone are
loaded from `cdnjs.cloudflare.com` (pinned exact versions) instead of being
bundled. Two consequences, both accepted trade-offs for a local-only
internal tool, not something to carry into an internet-facing app:

- **Requires outbound internet access** to that CDN on every page load (in
  addition to `*.elevenlabs.io` for the actual demo traffic). This is new
  compared to the original Electron prototype, which bundled all JS locally
  and made zero third-party calls.
- **`script-src` includes `'unsafe-inline' 'unsafe-eval'`** (see
  `app.py`'s `set_security_headers`). Babel standalone transforms and
  executes `<script type="text/babel">` tags in the browser at runtime,
  which needs this relaxation. No customer or account data is affected by
  this -- it only weakens protection against a hypothetical XSS in this
  app's own code -- but it's a real, deliberate trade-off versus the
  stricter CSP a bundled build would allow.

## Security notes -- read this before using the app with anyone else's keys

- **Accounts live only in `.env`**, never in the UI, never in
  `instance/config.json`. This is an intentional deviation from
  `spec-agent-bridge-demo.md` section 4 (which specifies an OS
  keychain/1Password flow with an "Add account" UI screen) -- for a
  single-user local tool, a gitignored `.env` is an accepted, simpler
  alternative to hardcoding a key in source. **`.env` must never be
  committed, pasted into a chat, or shared.**
- If you ever package and hand this tool to another FDE (as
  `spec-agent-bridge-demo.md` section 12 anticipates, via the AI Projects
  Tracker + review by the GTM tech lead), **revisit this decision first**.
- Never put a customer's production API key in `.env`. Use an internal demo
  account, or ask the prospect for a public agent / sandbox account.
- The browser never receives an API key, only short-lived signed WebSocket
  URLs (and even those are masked in the Flask logs -- see
  `routes/session.py`). The backend refuses to call any host outside
  `*.elevenlabs.io` (`services/eleven_api.py`).
- Use fictional scenarios only -- no real customer data in prompts or
  `personal_details` fields.

## What was verified against the live ElevenLabs docs (2026-10-01)

Both spec documents flagged a number of `[À VÉRIFIER]` points. These were
checked against https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket,
the overrides/dynamic-variables docs, and the REST API reference before
writing `services/eleven_api.py`, `static/js/session/AgentSession.js` and
`static/js/scenario/promptBuilder.js`:

| Point | Verified value |
|---|---|
| WS event names/fields | Confirmed: `conversation_initiation_client_data`, `conversation_initiation_metadata` (`conversation_initiation_metadata_event.{conversation_id,agent_output_audio_format,user_input_audio_format}`), `audio` (`audio_event.{audio_base_64,is_final}`), `interruption`, `user_transcript` (`user_transcription_event.user_transcript`), `agent_response` (`agent_response_event.agent_response`), `agent_response_correction` (`agent_response_correction_event.corrected_agent_response`), `vad_score`, `ping`/`pong`, `client_tool_call`, `contextual_update`. Client audio frames are sent as `{"user_audio_chunk": "<base64>"}` with **no** `type` field. |
| `conversation_config_override` shape | Confirmed nesting under `agent` (`prompt.prompt`, `first_message`, `language`), `tts` (`voice_id`, `speed`, ...), `asr` (`keywords`), `conversation` (`text_only`, `max_duration_seconds`). |
| Signed URL endpoint | `GET /v1/convai/conversation/get-signed-url?agent_id=...` with `xi-api-key` header, response field `signed_url`. Public agents connect directly to `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=...`, no key. |
| List/get agent endpoints | `GET /v1/convai/agents` (list, paginated via `cursor`/`has_more`), `GET /v1/convai/agents/{agent_id}` (get). Audio formats read from `conversation_config.asr.user_input_audio_format` / `conversation_config.tts.agent_output_audio_format`. |
| Get conversation (final transcript) | `GET /v1/convai/conversations/{conversation_id}`. |
| Reserved dynamic variable prefix | `system__` is reserved; the app never sends a key with that prefix. |

Still **not** independently verified (best-effort, defensive parsing used instead):

- The exact boolean shape of `platform_settings.overrides.conversation_config_override.*`
  on `GET /v1/convai/agents/{agent_id}` (used by Preflight to tell you which
  overrides are enabled). If Preflight reports an override as disabled when
  it's actually enabled (or vice-versa), trust the dashboard's Security tab.
- Regional (EU/IN/US data residency) base URLs. `ELEVENLABS_ACCOUNT_n_BASE_URL`
  in `.env` lets you override the host per account if ElevenLabs gives your
  workspace one. `initial_wait_time` / `silence_end_call_timeout` (turn-taking
  settings mentioned in `spec-agent-appelant.md` 3.3) were not found in the
  fetched docs either -- configure them directly in the dashboard.
- Whether a client-sent `agent.prompt.prompt` override is additive or
  conflicts with an agent built as a Workflow (spec-agent-appelant.md 7.3) --
  test this yourself before relying on "expert mode" with a Workflow-based
  caller agent.

## Setting up the two agents in the ElevenLabs dashboard

### Callee (the agent you're demoing)

No special setup required by this app -- it is demoed "as configured". Just
make sure, per the pre-flight checklist:
- Input/output audio format is `pcm_16000` (recommended for both agents).
- If you plan to force its language for a scenario, enable the
  `agent.language` override in its Security tab.

**If the callee's prompt uses `{{dynamic_variables}}`** (e.g. "You are the
receptionist at {{hotel_name}}"): click **Verify agent** on it in
**Settings → Agents**. The app reads the variables declared in the agent's
own "Dynamic Variables" dashboard panel (`conversation_config.agent.dynamic_variables.dynamic_variable_placeholders`)
and shows one next to the other with the dashboard's own default value. Any
variable with no dashboard default is flagged **required** -- fill it in
either:
- on the **Agent** itself (Settings → Agents), as a value sent on every
  session with that callee, or
- on a **Preset** (Settings → Presets), to override it for that one
  caller/callee/scenario combination only (takes priority over the agent's
  value).

Pre-flight blocks the launch if a required variable is still unresolved
either way (check id `callee-dynamic-variables`).

### Caller ("Caller Simulator") -- see `spec-agent-appelant.md` for full detail

- [ ] Create an agent named e.g. `Caller Simulator` on an **internal demo
      account**.
- [ ] Paste the system prompt from `spec-agent-appelant.md` section 4 and
      declare every `{{variable}}` listed in section 2 with a default value.
- [ ] First message = `{{opening_line}}`, default empty.
- [ ] Enable the languages you plan to demo.
- [ ] Turn settings: `turn_eagerness` normal, `turn_timeout` 8s,
      `initial_wait_time` 10-15s, `silence_end_call_timeout` 30s,
      interruptions on.
- [ ] System tools: `end_call` ON, `skip_turn` ON, `language_detection` OFF.
- [ ] Security tab -- enable exactly: `agent.language`, `agent.first_message`,
      `tts.voice_id`, `conversation.max_duration_seconds`, `asr.keywords`,
      and `agent.prompt.prompt` only if you'll use "Expert mode" in the
      Scenario editor.
- [ ] Audio format `pcm_16000` in and out.

## Architecture

```
agent-bridge/
├─ app.py                   Flask app factory, CSP header, serves templates/index.html
├─ routes/                  accounts.py, agents.py, session.py, config.py, exports.py,
│                           benchmark_runs.py, debug_logs.py
├─ services/
│  ├─ secrets.py            .env -> account list (never exposes the key past this module)
│  ├─ eleven_api.py         REST client (allowlisted to *.elevenlabs.io)
│  ├─ config_store.py       instance/config.json + instance/exports/*.json
│  ├─ benchmark_store.py    instance/benchmark_runs.json + pending-restore safety net
│  └─ debug_log_store.py    instance/debug_logs/*.json (per-scenario-run event/metrics telemetry,
│                           posted by the frontend during a benchmark run for post-hoc debugging)
├─ templates/index.html     loads CDN React/Babel, then every static/js file in order
└─ static/
   ├─ css/styles.css
   └─ js/
      ├─ bootstrap.js       creates window.AB, the shared namespace every file attaches to
      ├─ api.js             fetch wrapper around the Flask API (replaces the old Electron IPC bridge)
      ├─ audio/             pcm.js, Pacer.js (100ms cadencer + underrun/flush), Player.js, mic.js/mic.worklet.js
      ├─ scenario/          dynamicVariables.js, promptBuilder.js, examplePresets.js (spec-agent-appelant.md)
      ├─ session/           AgentSession.js (1 websocket), Preflight.js, Bridge.js (orchestration + deadlock
      │                     detection), TranscriptStore.js, BenchmarkRunner.js, RunHistory.js, GlobalAnalytics.js
      ├─ model/factory.js, metrics.js, hooks/useAppConfig.js
      └─ ui/                SessionScreen, SettingsScreen, HistoryPanel, AnalyticsPanel,
                            BenchmarkSession, BenchmarkAnalyticsViews, App, settings/* (.jsx, Babel-
                            transpiled in-browser; settings/ has one panel per Settings tab --
                            Accounts/Agents/Scenarios/Presets/Benchmarks/Audio)
```

No module system: every file attaches what it exports to `window.AB` (see
`bootstrap.js`), and `templates/index.html` loads every file as a plain
`<script>` tag in dependency order. Only files containing JSX use
`type="text/babel"`; pure-logic files are loaded as ordinary scripts (modern
browsers support ES6 classes/arrow functions/etc. natively, no transform
needed).

The browser never receives an API key -- only what `static/js/api.js` gets
back from the Flask JSON API (see `shared` field names: the API uses
snake_case throughout, e.g. `has_key`, `input_format`, `overrides_enabled`).

## Known limitations / follow-ups

- The ASR-comparison and "replace with the official transcript" UI
  (`spec-agent-bridge-demo.md` 8.4) fetches the official transcript but only
  logs it to DevTools for now -- a side-by-side diff view is a follow-up.
- No audio resampler: both agents must use `pcm_16000` (Preflight blocks
  otherwise, as the spec allows in v1).
- Translation toggle (`spec-agent-bridge-demo.md` 8.3, marked v2 in the
  spec) is not implemented.
- No packaging/distribution story yet (this used to be an Electron
  `.app`/`.exe`; now it's "run `flask run` locally"). If you want to hand
  this to another FDE, get it logged in the AI Projects Tracker and
  reviewed first (spec section 12), and reconsider the `.env` secret
  storage per the security note above.

## Tests

```bash
source .venv/bin/activate
pytest -v
```

Covers `services/secrets.py` (.env parsing, id stability, no key leakage),
`services/eleven_api.py` (host allowlisting, response parsing, mocked
HTTP), `services/config_store.py` (load/save, secret-stripping, export path
traversal), `services/benchmark_store.py` (run round-trips, pending-restore
safety net) and `services/debug_log_store.py` (round-trips, secret-stripping,
path traversal), plus the Flask routes end-to-end via the test client.

There is no JS test runner in this stack (no Node build step). The pure
frontend logic (`Pacer`, `TranscriptStore`, `promptBuilder`/`dynamicVariables`,
`Preflight`) was unit-tested in the earlier TypeScript/Vitest prototype
(see `_legacy-electron-version/renderer/src/test/`) and ported function-for-function;
verify it manually per `spec-agent-bridge-demo.md` section 14 (acceptance
criteria) and `spec-agent-appelant.md` section 8 (caller test plan) after
any change to `static/js/session/` or `static/js/audio/`.
