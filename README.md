# PandocGui

A small, fast, cross-platform desktop GUI for [pandoc](https://pandoc.org/).
Drop a file, pick an output format, click **Convert** — and see the exact
pandoc command while you do it.

See [PLAN.md](PLAN.md) for the full design, scope and roadmap.

## What it does (v1)

- Drag a file onto the window, or browse with a native dialog
- Detects the input format from the extension (`.docx`, `.md`, `.tex`,
  `.html`, `.epub`, `.odt`, `.rst`, …)
- Output format dropdown; the output path defaults to the same folder with the
  new extension (and never points at the source file)
- Options: `--wrap=none`, `-s` standalone, `--toc`, `--extract-media`,
  `--reference-doc`
- Live command preview with copy button
- Shows pandoc's stderr on failure, warnings on success
- Checks for pandoc on startup and tells you how to install it if missing
- Asks before overwriting an existing file, then reveals it in the file
  explorer

## Prerequisites

- Rust (`rustup`) and Node.js
- Pandoc
  - Windows: `winget install JohnMacFarlane.Pandoc`
  - Linux: `sudo apt install pandoc`
- Linux build deps: `libwebkit2gtk-4.1-dev build-essential libssl-dev
  libayatana-appindicator3-dev librsvg2-dev`

## Develop

```sh
npm install
npm run dev        # tauri dev — live-reloading app window
```

## Test

```sh
cd src-tauri
cargo test         # includes an end-to-end conversion through real pandoc
```

## Build a bundle

```sh
npm run build      # src-tauri/target/release + installer for your OS
```

## Project layout

```
src/                 frontend: plain HTML/CSS/JS (no framework, no bundler)
  index.html         layout
  main.js            state, option handling, Tauri invoke calls
  styles.css         styling, follows the OS light/dark scheme
src-tauri/           Rust backend
  src/lib.rs         check_pandoc / convert / derive_output / … + tests
  capabilities/      permissions (core, dialog, opener)
  tauri.conf.json    window, bundle, product name
```

## How the pieces fit

The frontend builds the pandoc argument list and shows it as a live preview,
then passes it to the Rust `convert` command. The backend resolves paths
(absolute, no quoting bugs — arguments travel as a list, not a string), spawns
`pandoc <input> -o <output> <args...>` with no console window on Windows, and
returns stderr for display.
