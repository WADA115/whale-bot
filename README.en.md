# QQ ↔ DeepSeek Harness Bridge (whale-bot)

> A self-hosted QQ bot: chats, reads images, remembers you, and ships with a local control panel.
> **Chinese docs are primary** — [README.md](README.md) · [FAQ.md](FAQ.md) · [使用手册.md](docs/使用手册.md).

---

## What it is

```
QQ message → SnowLuma (OneBot v11 gateway) → bridge → DeepSeek → reply
                                        ↕
                    memory (per-user) / context / expression / drawing
                                        ↕
                        panel :3200 + reverse proxy :5098
```

Not an official product. It speaks through **your own QQ account**, and all data stays on your machine.

---

## Features

- **Chat** — private chats always answered; group chats decide whether they're being addressed (smart / mention-only / always). Random interjections with cooldown. Long replies split into 2–5 bubbles.
- **Understands media** — images read directly, GIFs sampled, videos sampled + audio transcribed, voice transcribed locally (audio never leaves the machine).
- **Memory (5 layers, per-user)** — settings / long-term / short-term (72 h decay, promoted after 2 hits) / keywords / summaries (auto-compressed past 24 turns). Developers keep `state/memory.json`; every normal user gets `state/profiles/<user>/memory.json`.
- **Memory isolation** — profiles are scoped by account, but all accounts share the same process and `state/` directory; isolation relies on auth + path checks, not an OS sandbox. Normal users cannot read the developer's memory.
- **Auto memory** — a local heuristic decides whether a message is worth remembering (identity/preference → long-term, recent facts → short-term). No model call, but it is heuristic and can misremember or miss; it never touches persona cards or settings.
- **Persona cards** — markdown cards in `roles/`, editable in the panel; saving syncs them into the memory "settings" layer.
- **Plugins** — `plugins/<name>/` with `manifest.json` + `index.mjs`, hooks `onInbound / onReply / onMemory`. New plugins must pass manifest validation, heuristic static scanning and a child-process startup check before they can be enabled (the scan can be bypassed and is not a sandbox); at runtime each plugin runs in its own child process (3 s per hook), so a crash or infinite loop only takes down that plugin. A learning plugin ships disabled by default.
- **Memory / emotion weights** — 1–5 each, auto-tuned from the persona card, settings and context; memory weight scales how much context is injected (relevant items only, never the whole store). Manual overrides are developer-only.
- **Kaomoji** — after the text, occasionally send a kaomoji (34 built in, chosen by keywords + mood); same cooldown family as stickers/faces, 5-minute separate cooldown, skipped when the reply already contains one.
- **Speech-to-text that self-heals** — `start-asr.bat` auto-detects Python and the onnx runtime; the watchdog probes both the bridge (3100) and ASR (3199, port + `/health`) and restarts whichever is down with per-service backoff.
- **Panel** — overview, settings, memory (5 tabs), plugins, appearance (6 whale mascots with blink animation), environment check (read-only), help, changelog.
- **Growth** — de-noised chat snippets are filtered twice a day by the model, a weekly pass evolves traits / needs / attachment and advances stages (stranger → familiar → close → tacit); every evolution is snapshotted and can be rolled back, and it shifts tone/memory/expression by at most ±20%, switchable off. Each evolution also writes a short self-narrative: visible everywhere by default but strictly reviewed before groups / other users see it (secrets, numbers, addresses dropped), with scope and review switches.
- **Safety** — outbound heuristic path/credential filter (not a classifier), tool guard for privileged actions, rate limits, IP redaction in logs.

---

## Requirements

| | |
| --- | --- |
| Node.js | ≥ 20 (SnowLuma itself wants 24+) |
| Gateway | SnowLuma (default) or any OneBot v11 implementation |
| Optional | FFmpeg (media), Python (sketch / local ASR), sherpa-onnx (speech) |

---

## Quick start

```bash
npm install
cp config.example.json config.json     # fill ownerQQ / allow.* / snowluma.homeDir / dsh.baseUrl
scripts/ops/start-asr.bat /silent   # ASR → :3199 (auto-detects Python + onnx deps)
node app.js                            # panel  → http://127.0.0.1:3200
node src/bridge.js                     # bridge → :3100
```

Then open the panel, log in with the developer key (auto-generated at `state/dev-key.txt`), and sign in to QQ inside SnowLuma.

---

## Console

![Console overview](docs/screenshots/panel.png)

| Settings | Memory |
| --- | --- |
| ![Settings](docs/screenshots/settings.png) | ![Memory](docs/screenshots/memory.png) |

| Plugins | Login |
| --- | --- |
| ![Plugins](docs/screenshots/plugins.png) | ![Login](docs/screenshots/login.png) |

Overview (services / metrics / logs) · Settings (model, persona, behavior, voice, emotion, weights, reply shape, trusted list, accounts, developer mode) · Memory (five layers + hidden vault) · Plugins (verification status) · Appearance (6 original whale mascots, blinking) · Environment check (read-only) · Help · Changelog

---

## Configuration (excerpt)

```json
{
  "ownerQQ": "YOUR_QQ",
  "allow": { "private": ["YOUR_QQ"], "groups": ["YOUR_GROUP"] },
  "gateway": { "type": "snowluma" },
  "snowluma": { "homeDir": "C:\\SnowLuma", "httpUrl": "http://127.0.0.1:3000", "wsUrl": "ws://127.0.0.1:3001" },
  "dsh": { "baseUrl": "http://127.0.0.1:PORT" },
  "panel": { "registerPerHour": 20 },
  "role": {
    "groupTrigger": "smart",
    "memory": { "autoRemember": true, "compress": true, "compressAfterTurns": 24 },
    "expression": { "enabled": true, "stickerChance": 0.22, "faceChance": 0.12 }
  }
}
```

Switch gateways by setting `gateway.type = "onebot"` — the bridge does not change.

---

## Repository layout

```
app.js              panel (:3200) + SnowLuma reverse proxy (:5098)
src/bridge.js       bridge (0.7 MB — run the tests before editing)
src/gateway/        gateway adapters (snowluma / onebot)
src/memory-core.js  layered memory + multi-tenant store
src/auto-memory.js  local "is this worth remembering?" judge
src/env-scan.js     read-only environment scanner
roles/              persona cards
plugins/            plugin packages
assets/icons/       6 original mascots (PNG + ICO, MIT)
tests/              19 automated tests + self-check / doc checks
state/              accounts, memory, logs, backups (gitignored)
```

---

## Testing

```bash
node tests/run-offline.mjs    # CI-safe subset (no panel, no network)
```

<!-- STATS:OFFLINE:START -->
Offline tests: 40/40 passing (CI-generated)
<!-- STATS:OFFLINE:END -->

Tests that need extra conditions (API key, `QQB_E2E=1` + running panel) skip themselves instead of failing; the full suite runs in the maintainer environment, so its count is not hard-coded here.

---

## Security

- Panel binds `127.0.0.1` only; unauthenticated visitors see the login page and guide only.
- Passwords: scrypt + random salt (N=16384, r=8, p=1, keylen=32). Login rate limits, exponential backoff for the developer key.
- Developer key never lives in code: env → `state/dev-key.txt` → generated on first run.
- Normal accounts get 403 on global config / memory / local management.
- Private vulnerability reporting is enabled — see [SECURITY.md](SECURITY.md).

**Do not expose the panel to the public internet.** It has no 2FA, no CSRF tokens and no audit log.

---

## Compliance & disclaimer

Running automation on your own QQ account technically violates Tencent's terms of service. Rate limits, content filtering and no mass-messaging reduce — but cannot eliminate — the risk of account restrictions. See `免责声明.md`.

Third-party components keep their own licenses; see [致谢.md](docs/致谢.md) and [LICENSE](LICENSE).

## License

MIT — upstream qq-bridge / QSH copyright notices preserved, project attribution added.
