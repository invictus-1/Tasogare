# Working on Tasogare

**New here?** Read [docs/HANDOFF.md](docs/HANDOFF.md) first: what Tasogare is, where it stands, how the owner and Claude work together, and the quirks of this machine. Then this file.

Tasogare is a local-first Windows desktop app (Electron + React + TypeScript) for writing with language models: chat with Claude and OpenAI-compatible models, split compare, a writing editor with Forge-style tools, the Judge, choice cards for text adventures, and Writer insights. This file is what a new session needs to pick the work up, whichever account it runs under.

## Ground rules

- **The name is 黄昏 (Tasogare)**, renamed from Twilight in 1.6. The window title and wordmarks show 黄昏 and prose says Tasogare. The old name stays where changing it would break an existing install, so leave these as they are: the data folder `%APPDATA%\Twilight` (its database holds full paths into it), `twilight.db`, the appId `app.twilight.desktop` (the installer's identity for updates), the `twilight.*` settings keys, the `window.twilight` bridge and `twilight:` channels, the `TWILIGHT_*` switches, and the Twilight colour theme. The updater and installer accept both names, and each release also uploads a `Twilight-Setup-<version>.exe` copy for copies from before 1.6.

- **Nothing personal in the repo, ever.** It is public. No names, emails, file paths from anyone's machine, private writing, system prompts or rubrics, chat transcripts, or links to personal accounts. Demo content and tests use invented text (the lighthouse story in `src/main/showcase.ts`, Wren and Rowan in the tests). Personal files that the app can import (a rubric, say) live in `private/`, which is git-ignored.
- **Fresh installs start clean.** Nothing user-specific ships in the app: no built-in rubric beyond General fiction, no default system prompt content, every model hidden until chosen.
- **Commits and pushes to `main` are fine without asking.** Never force-push unless the user asks for it.
- **Releases:** fixes go out as patch versions (1.5.2, 1.5.3, …) when the owner asks; a new minor or major version (1.6, 2.0) only for new features big enough to warrant it. All are GitHub releases of this repository (the updater reads them). Always ask before running `npm run release`, because it publishes publicly.
- Builds strip the project folder path from every bundle (electron.vite.config.ts), and `npm run release` refuses to publish if any built file still holds a path from this machine. Keep both.
- Avoid destructive shell commands (`rm -rf` is blocked). Write multi-line scripts and patches as files rather than heredocs: the shell here mangles backslashes in heredocs.
- Keep CHANGELOG.md (a section per version; it becomes the release notes) and ROADMAP.md (drawn in the app as Settings → Roadmap; keep its line format) current with every change.

## Commands

```bash
npm install
npm run dev          # the app with hot reload
npm run typecheck    # both TypeScript projects
npm run dist         # Windows installer + zip in release/ (the animated installer needs Visual Studio's C++ tools)
npm run release      # publish release/ as a GitHub release (ask first)
```

Testing (each runs the real app against a throwaway profile; nothing touches real data):

```bash
npx electron-vite build
TWILIGHT_E2E=<dir> npx electron .         # end-to-end suite → <dir>/e2e.json + screenshots
TWILIGHT_SELFTEST=<dir> npx electron .    # scroll performance on a 450-turn chat
TWILIGHT_SHOWCASE=<dir> npx electron .    # README screenshots from demo data
TWILIGHT_SHOWCASE_THEMES=1 TWILIGHT_SHOWCASE=<dir> npx electron .    # the theme tour: seven surfaces in every theme (or =ember,aurora for some)
node scripts/bench.cjs <label>            # startup, navigation, memory and scroll on the packaged app → bench/<label>.json
```

Also run the e2e suite against the packaged build after `npm run dist`: `TWILIGHT_E2E=<dir> release/win-unpacked/Tasogare.exe`. Every feature gets e2e checks in `src/main/e2e.ts`; the suite must pass fully before a commit.

## Map

- `src/main/` — Electron main process. `chat.ts` (conversation trees, generate, delete/restore/edit), `db.ts` (SQLite: conversations, nodes, kv, deletions, doc_stats, writing_days), `providers/` (Anthropic and OpenAI-compatible, model lists, keys), `judge.ts`, `writing.ts` (editor tools), `docs.ts` (writing folder), `insights.ts` + `insights.worker.ts` (Writer insights tracker), `updates.ts` (GitHub releases updater), `search.ts` (search everything), `code/` (the Code tab's agent: `agent.ts` loop, approvals and the rules it is given, `workspace.ts` folder confinement, links, key files, snapshots and commands, `llm.ts` steps), `mcp/` (MCP client and server registry), `images.ts` + `generated.ts` (pictures), `docLibrary.ts` (document library index and search, in its own library.db; passages keep their headings, and `gather` widens picks into story-ordered stretches), `scout.ts` (the context scout: a small model picks library passages before a reply, plus its test), `localModels.ts` (Models on this PC: hardware, Hugging Face search and downloads, llama.cpp fetched and run in router mode as the This PC provider), `backups.ts` + `location.ts` + `settle.ts` (backups, restore, moving the data folder; they act at startup before the database opens, and `settle.ts` asks about a moved folder that is missing and shows a move's progress), `winTools.ts` (Windows' own tools by full path, so nothing of the same name in a folder stands in for them), `contextMenu.ts` (right-click menu and spellcheck), `e2e.ts`, `selftest.ts` (`TWILIGHT_SELFTEST_FX=<style>` measures scrolling with particles on), `showcase.ts`.
- `src/shared/` — types and logic used on both sides: `types.ts` (the IPC API), `choices.ts` (choice-card parsing and the present_choices tool), `insights.ts` (text analysis, achievements), `judge.ts`, `roadmap.ts`, `gameFormat.ts`, `pricing.ts`, `attachments.ts` (what can be attached, context blocks, limits), `themes.ts` (the theme list), `code.ts` (Code tab types, line diff, the checks on commands, edits, key files and invisible characters), `mcp.ts` (tool naming, tool steps shown under replies), `docLibrary.ts` (library passages block, scout types), `localModels.ts` (fit check, size labels), `backups.ts`.
- `src/preload/index.ts` — the `window.twilight` bridge; every API method is listed there.
- `src/renderer/src/` — React UI. `store.ts` (zustand), `commands.ts` (every command, its shortcut and rebinding; the command menu, shortcut sheet and rail read it), `highlight.ts` (code highlighting), `focus.ts` (who has the keyboard: focus that never takes it from someone typing, and leaving a field so it saves), `components/` (one file per surface), `styles/tokens.css` + `styles/app.css` + `styles/themes.css`.
- `installer/` — the animated installer: `ui/index.html` (the welcome's evening), `setup.cpp` (a WebView2 window that runs electron-builder's NSIS installer silently, so uninstall, shortcuts and upgrades stay NSIS's), `build.cjs` (fetches the WebView2 SDK, compiles, appends the NSIS installer, rewrites latest.yml). `/S` passes straight through for the updater; `--extract <file>` writes the bundled NSIS installer out; `TWILIGHT_SETUP_DRYRUN=1` plays the window without installing.
- `design/` — the design system: tokens, component guidelines and previews. Follow it for anything visual.
- Themes: `src/shared/themes.ts` lists them and `styles/themes.css` holds each one's colours and its still art (`--ground-art` behind the chat, `--side-art` behind the rail and sidebar, `--hero-sky`, `--welcome-sky`, `--chevron`, and the shared details `--head-line`, `--accent-run`, `--user-fill`, `--quote-line`, `--rule-line`, `--halo`, `--thumb`). Art is still and painted once, never animated, so scrolling costs nothing; High contrast has none; `customTheme.ts` derives the same for a built theme. Check a change by eye with the theme tour.

## How things are built

- Requests are built append-only so the prompt cache keeps working: stored assistant blocks are replayed byte-for-byte, history trims in steps, and anything new goes at the end.
- The interface never reaches the network; model calls and the daily update check run in the main process.
- Tools Tasogare runs itself (MCP, pictures, search_library) are rounds inside one stored reply (`tool_results` blocks for Claude, `tool_round` blocks for OpenAI-compatible), replayed exactly; see `providers/`.
- The Code agent treats everything it reads as information, never instruction, and every way in is checked in `src/shared/code.ts` and `code/workspace.ts`: what a command or an edit would do, files that hold keys, invisible characters, links and odd Windows names. A new tool or a new way to run something gets the same checks and e2e cases (section 59 of the suite).
- Anything that can lose work asks first and can be undone: Code snapshots before each change, deletions go to the Recycle Bin, backups are made before a restore or a move.
- Where things stand: 1.6.2 is released (the Chats button showing the sky by itself, with New chat bringing the chat in; 1.6.1: the Code agent locked down against text written to steer it, Whole chat reading the cache, a missing data folder asked about, Moonlit Paper's sky, the theme art and the fixes from a read-through of the whole app). The owner considers Tasogare feature complete: from here, fixes from use, shipped as patch releases (1.5.2, 1.5.3 …) when they ask, and new work only when they ask, as 1.6, 1.7 or 2.0 if it is big enough (1.6.0: renamed from Twilight to 黄昏 (Tasogare); 1.5.5: shooting stars no longer pile up off screen, the cache bar's × hides it for one chat only; 1.5.4: changing a selected passage can be stopped, given a note, says what it sends and stays in the window; 1.5.3: find in a chat goes to every match, opening whatever folds it; 1.5.2: smoother scrolling over the city, the sky holding still while you type; 1.5.1: instant chart labels, asking about pasted words in Insights, centred Settings with an Appearance preview; 1.0 was the foundation; 1.1–1.3 requests from daily use and Extras; 1.4 the context scout, Models on this PC, multiverse drafts, the branch map, the blind arena, offline voice, Continuity in Writing and scenes under the sky; 1.5 the visitors' acts on every scene with the pumpkin plush, weather, and big mixture-of-experts models on a modest card). The visitors' acts are checked by eye with `TWILIGHT_ACTS=<dir> npx electron .` (src/main/actShots.ts: `TWILIGHT_ACTS_ONLY`, `TWILIGHT_ACTS_AT`, `TWILIGHT_ACTS_WEATHER`, `TWILIGHT_ACTS_PROBE`, `TWILIGHT_ACTS_THEME`, `TWILIGHT_ACTS_SKY`). The story bible and continuity watcher were built and shelved (branch `shelved/story-bible`; why in docs/HANDOFF.md).
- Comments explain why, in plain sentences, at the density of the surrounding code. UI copy is short, sentence case, no exclamation marks.
