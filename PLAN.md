# PandocGui: Project Plan

A small, fast, cross-platform (Windows + Linux) desktop GUI for [pandoc](https://pandoc.org/). Drop a file, pick an output format, click Convert. No more remembering commands.

## Goals

- **Fast**: instant startup, tiny binary, no heavy runtime.
- **Simple**: one window, drag-and-drop, minimal options.
- **Cross-platform**: one codebase producing Windows and Linux builds.
- **Transparent**: shows the exact pandoc command so users learn the flags over time.

## Non-goals (v1)

- Bundling a LaTeX engine or full PDF pipeline.
- Editing documents or previewing output.
- macOS support (may come free with Tauri later, but untested).

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| App framework | **Tauri v2** | ~3-10 MB bundles, uses the OS webview, Rust backend |
| Backend | Rust | Spawns `pandoc` via `std::process::Command`; args passed as a list, so no quoting bugs with spaces |
| Frontend | Plain HTML/CSS/JS (no framework) | Keeps startup instant and the bundle tiny |
| File dialogs | `tauri-plugin-dialog` | Native pickers |
| CI/CD | GitHub Actions + `tauri-action` | Build Windows and Linux on their own runners |

Alternatives considered: Avalonia (C#, bigger bundle), Python + Tk/PySide (slower startup, larger package), WinForms (Windows-only).

## Prerequisites

- Rust (`rustup`) and Node.js
- Pandoc
  - Windows: `winget install JohnMacFarlane.Pandoc`
  - Linux: `sudo apt install pandoc`
- Linux build deps: `libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- Windows: WebView2 (preinstalled on Windows 10/11)

## Architecture

```
┌──────────────────────────┐        invoke("convert")        ┌───────────────────────┐
│ Frontend (HTML/JS)       │ ───────────────────────────────▶│ Rust backend          │
│ - drop zone / browse     │                                 │ - builds Command      │
│ - from/to dropdowns      │ ◀───────────────────────────────│ - runs pandoc         │
│ - options + cmd preview  │        Ok(msg) / Err(stderr)    │ - returns stderr      │
└──────────────────────────┘                                 └───────────────────────┘
```

- The frontend builds the argument list and shows a live command preview.
- The backend runs `pandoc <input> -o <output> <args...>` and returns stderr as the message.
- On Windows, set `CREATE_NO_WINDOW` (`0x08000000`) so no console window flashes.

## Features

### v1 (MVP)

- [x] Drag-and-drop a file onto the window (via Tauri's drag-drop event, which gives real paths)
- [x] Browse button (native file dialog)
- [x] Auto-detect input format from extension (`.docx`, `.md`, `.tex`, `.html`, `.epub`, `.odt`, `.rst`)
- [x] Output format dropdown: docx, md (GFM), tex, html, epub, odt, rst
- [x] Output path defaults to the same folder with the new extension; editable
      (never points at the source file — same-format conversions get a `-converted` suffix)
- [x] Options:
  - [x] `--wrap=none` (clean markdown)
  - [x] `--extract-media=media` (docx to md, keeps images; auto-checked for docx/odt/epub)
  - [x] `-s` standalone (auto-checked for tex/html)
  - [x] `--toc`
  - [x] `--reference-doc` picker (shown only for docx/odt writers)
- [x] Live command preview
- [x] Convert button with a status/error area showing pandoc's stderr
- [x] Pandoc detection: check PATH, show a clear message if not found

### v1.1

- [ ] "Pandoc path" setting (override auto-detection) — backend already accepts `pandocPath`, no UI yet
- [ ] Remember last-used options (small JSON config in the app data dir)
- [x] Open output folder after conversion
- [x] Overwrite confirmation if output exists

### v2 (nice to have)

- [ ] Batch conversion (drop multiple files)
- [ ] Saved presets (e.g. "docx to clean md with media")
- [ ] Bundle pandoc as a Tauri sidecar (`externalBin`, per-platform suffix) so nothing needs installing
- [ ] PDF output when a LaTeX engine, Typst, or wkhtmltopdf is detected
- [ ] Shell integration (right-click "Convert with PandocGui")
- [x] Dark mode following the OS theme

## Milestones

1. **Scaffold**: `npm create tauri-app@latest` (vanilla JS), confirm `npm run tauri dev` runs on both OSes. ✅
2. **Backend**: `convert` command working from a hardcoded call; verify the Windows no-console flag. ✅
3. **UI**: layout, dropdowns, option checkboxes, command preview. ✅
4. **Wiring**: browse dialog, drag-and-drop, extension-based format detection, default output path. ✅
5. **Error handling**: pandoc-not-found message, stderr display, overwrite check. ✅
6. **Polish**: window size, icon, app name, keyboard shortcuts (Enter to convert). ✅
7. **CI**: GitHub Actions matrix producing `.msi`/`.exe` and `.deb`/`.AppImage`. ✅
   (`.github/workflows/ci.yml` — tests on every push; `windows-latest` + `ubuntu-24.04` build
   bundles on a `v*` tag and attach them to a draft release; runner pinned ahead of the
   `ubuntu-latest` migration to 26.04.)
8. **Release**: tag a version, publish artifacts to GitHub Releases.

## Project Structure (expected)

```
pandoc-gui/
├── PLAN.md
├── package.json
├── src/                    # frontend
│   ├── index.html
│   ├── main.js
│   └── style.css
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── capabilities/       # permissions (dialog, drag-drop)
    └── src/
        └── lib.rs          # convert command
```

## Cross-platform Notes

- Cross-compiling Tauri apps is awkward; build each OS on its own runner (CI matrix).
- Let Rust's `std::path::Path` handle extensions and joins; no hardcoded `\` or `/`.
- Test paths with spaces and non-ASCII characters on both OSes.
- Linux packaging: `.deb` and `.AppImage` cover most users.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Pandoc not installed | Detect on startup, show a friendly message with the install command; bundle as a sidecar in v2 |
| PDF needs a LaTeX engine | Out of scope for v1; detect engines in v2 |
| WebKitGTK differences on Linux | Keep the UI simple (plain CSS), test on Ubuntu early |
| Overwriting user files | Confirm before overwrite; default output to a new filename |

## Pandoc Cheat Sheet (for presets and testing)

```
pandoc in.docx -o out.md --wrap=none --extract-media=media   # docx -> md
pandoc in.md -o out.docx                                      # md -> docx
pandoc in.md -o out.docx --reference-doc=template.docx        # md -> styled docx
pandoc in.md -s -o out.tex                                    # md -> tex (standalone)
pandoc in.md -t gfm -o out.md                                 # normalise to GitHub-flavoured md
pandoc in.md -s --toc -o out.html                             # md -> html with TOC
```

## Definition of Done (v1)

- Converts docx/md/tex/html/epub/odt/rst between each other correctly with the main options.
- Launches in under a second on a normal machine.
- Installer/bundle under ~15 MB.
- Runs on Windows 10/11 and a current Ubuntu LTS.
- Clear error shown when pandoc is missing or a conversion fails.
