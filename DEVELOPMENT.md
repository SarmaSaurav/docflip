# Development

DocFlip is a [Tauri v2](https://tauri.app) app: a Rust backend that shells out to `pandoc`, and
a framework-free HTML/CSS/JS frontend (`src/`) with no bundler or build step.

## Prerequisites

- [Rust](https://rustup.rs) (via `rustup`)
- [Node.js](https://nodejs.org) — only for the Tauri CLI, not at runtime
- `pandoc` — the test suite runs real conversions
- Linux only: `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev
  libayatana-appindicator3-dev librsvg2-dev`

## Run and build

```sh
npm install

npm run dev      # app window with rebuild-on-change
npm run build    # release binary + installers
```

Bundles land in `src-tauri/target/release/bundle/` (`msi/`, `nsis/` on Windows; `deb/`,
`appimage/` on Linux — a `.deb` cannot be built on Windows).

The frontend falls back to a mock backend when `window.__TAURI__` is absent, so you can open
`src/index.html` in any browser and exercise the whole UI without a Rust toolchain.

## Tests

```sh
cd src-tauri
cargo test
```

Seven tests, run against a real pandoc: Markdown→HTML conversion, output-path derivation
(same format gets a `-converted` suffix), refusal to overwrite the input, paths with spaces
and non-ASCII characters, and propagation of pandoc's stderr.

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
(`0x08000000`) so no console flashes.

```
src/                 frontend: index.html, main.js, styles.css
src-tauri/           Rust backend
  src/lib.rs         check_pandoc · convert · derive_output · sibling_path · file_exists (+ tests)
  capabilities/      permissions (core, dialog, opener)
  tauri.conf.json    window, bundle, product name, identifier
assets/icon.svg      icon source → rendered to assets/icon-1024.png
src-tauri/icons/     generated icon set (ico, icns, store logos)
docs/screenshot.png  README screenshot
PLAN.md              design, scope, roadmap
```

## Icons

`assets/icon.svg` is the source of truth; `assets/icon-1024.png` is the rendered 1024×1024 PNG.
Regenerate every platform size with:

```sh
npx tauri icon assets/icon-1024.png
```

## CI and releases

`.github/workflows/ci.yml` runs on GitHub-hosted runners:

- **every push to `main` / pull request** → the Linux runner (`ubuntu-24.04`, pinned ahead of
  the `ubuntu-latest` migration to 26.04) runs `cargo test` against a real pandoc
- **every `v*` tag** → after the tests pass, a matrix builds `.deb` + `.AppImage` (Linux) and
  `.msi` + NSIS `-setup.exe` (Windows) and attaches all four binaries to a **draft** release

Cutting a release:

1. Bump the version in three places — `package.json`, `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml` — and commit.
2. Tag and push:

   ```sh
   git tag -a v0.2.0 -m "DocFlip v0.2.0"
   git push origin main v0.2.0
   ```

3. Watch the run in the *Actions* tab — ~10–15 min on a cold cache, faster with the Rust cache.
4. Review the draft release the workflow produced and click **Publish release**.

Git tags don't carry binaries; the bundles ride on the release, which is why CI attaches them
before you publish. Building by hand is still possible: run `npm run build` on each OS and
upload from `src-tauri/target/release/bundle/`.

## Roadmap

v1 (MVP) is done. Next, per [PLAN.md](PLAN.md):

- **v1.1** — pandoc path setting, remember last-used options
- **v2** — batch conversion, saved presets, bundled pandoc sidecar, PDF output when an engine
  is detected
