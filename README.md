# PandocGui

**A small, fast desktop GUI for [pandoc](https://pandoc.org/).** Drop a file on the window, pick
an output format, click Convert — no more remembering flags. The exact pandoc command is shown
live as you change options, so you learn it while you use it.

Windows and Linux, one codebase, ~1–2 MB installer, starts instantly.

[![CI](https://github.com/SarmaSaurav/pandocGUI/actions/workflows/ci.yml/badge.svg)](https://github.com/SarmaSaurav/pandocGUI/actions/workflows/ci.yml)

![PandocGui screenshot](docs/screenshot.png)

## Highlights

- **Drag and drop** a file onto the window, or browse with a native file dialog
- **Format detection** from the extension (`.docx`, `.md`, `.tex`, `.html`, `.epub`, `.odt`, `.rst`)
- **Seven output formats**: Word, Markdown (GitHub-flavoured), HTML, LaTeX, EPUB, OpenDocument, reStructuredText
- **Sensible defaults per format** — `--extract-media` pre-checked for docx/odt/epub sources, `-s`
  pre-checked for tex/html, `--reference-doc` offered only where it exists
- **Live command preview** with a copy button: every flag you toggle is visible before you run it
- **Honest output**: pandoc's stderr is shown when a conversion fails, warnings when it succeeds
- **Safe by default**: asks before overwriting, and never points the output at your source file
- **Knows when pandoc is missing** and tells you the install command for your OS
- **Open the output folder** in one click after converting
- Dark mode follows your OS; Enter converts

## Install

1. Grab the installer from [Releases](../../releases):
   - `PandocGui_*_x64-setup.exe` (NSIS) or `PandocGui_*_x64_en-US.msi` (Windows Installer)
2. Install pandoc — PandocGui shells out to it rather than bundling it:
   - Windows: `winget install JohnMacFarlane.Pandoc`
   - Linux: `sudo apt install pandoc`
3. Run PandocGui. A green **pandoc x.y.z** pill in the header means you're ready.

Nothing else is required at runtime: no Node, no Python, no browser install
(WebView2 ships with Windows 10/11).

## Use

1. Drop a file (or click the drop zone to browse)
2. Pick the output format — the output path defaults to the same folder with the new extension
3. Toggle options; the command line below updates as you go
4. Press **Enter** or click **Convert**

| Option | Flag | When it matters |
|---|---|---|
| Wrap | `--wrap=none` | Clean Markdown — no hard-wrapped lines |
| Standalone | `-s` | Self-contained `.tex`/`.html` with headers instead of a fragment |
| Table of contents | `--toc` | Long documents in HTML, LaTeX, EPUB |
| Extract media | `--extract-media=…` | Pulling images out of docx/odt/epub into a folder next to the output |
| Reference doc | `--reference-doc=…` | Styling the output from your own Word/OpenDocument template |

Output path defaults never overwrite your source: converting `report.docx` to docx writes
`report-converted.docx`.

## Build from source

Prerequisites: [Rust](https://rustup.rs) (`rustup`), [Node.js](https://nodejs.org) (for the Tauri
CLI), and pandoc for the tests. On Linux also
`libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev`.

```sh
git clone https://github.com/SarmaSaurav/pandocGUI.git
cd pandocGUI
npm install

npm run dev     # app window with rebuild-on-change
npm run build   # release binary + installers
```

Bundles land in `src-tauri/target/release/bundle/` (`msi/`, `nsis/`, and on Linux `deb/`,
`appimage/`). Current sizes: **1.4 MB** NSIS, **2.1 MB** MSI.

```sh
cd src-tauri && cargo test   # 7 tests, including real pandoc conversions
```

The tests exercise actual conversions, paths containing spaces and non-ASCII characters, and
error propagation from pandoc's stderr.

## Cut a release

CI does the building — no Linux machine or Windows box required, GitHub's hosted runners handle
it (`.github/workflows/ci.yml`):

- **every push to `main`** → the Linux runner installs the WebKitGTK dependencies and runs
  `cargo test` against a real pandoc
- **every `v*` tag** → after the tests pass, a matrix builds `.deb` + `.AppImage` on
  `ubuntu-latest` and `.msi` + NSIS `-setup.exe` on `windows-latest`, then attaches all four
  binaries to a **draft** release

Cutting one:

1. **Bump the version in three places** — `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` — and commit:

   ```sh
   git commit -am "chore: release v0.2.0"
   ```

2. **Tag and push:**

   ```sh
   git tag -a v0.2.0 -m "PandocGui v0.2.0"
   git push origin main v0.2.0
   ```

3. **Watch the run** in the *Actions* tab — ~10–15 min on a cold cache, faster afterwards.

4. **Publish the draft** the workflow produced: *Releases* → `PandocGui v0.2.0` (Draft) → check
   the notes and the four attached binaries → **Publish release**.

Git tags don't carry binaries — the bundles ride on the release, which is why CI attaches them
before you publish.

### Building bundles by hand

Alternative to CI: run this on each OS you want to ship for

```sh
npm run build
```

Output lands in `src-tauri/target/release/bundle/` — `msi/` + `nsis/` on Windows, `deb/` +
`appimage/` on Linux (a `.deb` cannot be built on Windows). Attach the files on the release
page, or with [GitHub CLI](https://cli.github.com/):

```sh
gh release create v0.2.0 \
  src-tauri/target/release/bundle/nsis/PandocGui_0.2.0_x64-setup.exe \
  src-tauri/target/release/bundle/msi/PandocGui_0.2.0_x64_en-US.msi \
  --title "PandocGui v0.2.0"
```

## How it works

```
┌──────────────────────────┐      invoke("convert")       ┌───────────────────────┐
│ Frontend (plain HTML/JS) │ ───────────────────────────▶ │ Rust backend          │
│ drop zone · dropdowns    │                              │ resolves paths        │
│ options · command preview│ ◀─────────────────────────── │ spawns pandoc         │
└──────────────────────────┘    Ok(warnings) / Err(stderr)└───────────────────────┘
```

The frontend builds the argument list and renders it as the preview; the backend passes those
arguments to `std::process::Command` **as a list**, so paths with spaces or non-ASCII characters
never go through shell quoting. On Windows pandoc is spawned with `CREATE_NO_WINDOW`
(`0x08000000`) so no console flashes. `src/` is deliberately framework- and bundler-free.

```
src/                 frontend: index.html, main.js, styles.css
src-tauri/           Rust backend
  src/lib.rs         check_pandoc · convert · derive_output · sibling_path · file_exists (+ tests)
  capabilities/      permissions (core, dialog, opener)
  tauri.conf.json    window, bundle, product name
docs/screenshot.png  README screenshot
PLAN.md              design, scope, roadmap
```

## Roadmap

v1 (MVP) is done. Next up, per [PLAN.md](PLAN.md):

- **v1.1** — pandoc path setting, remember last-used options
- **v2** — batch conversion, saved presets, bundled pandoc sidecar, PDF output when an engine is
  detected
