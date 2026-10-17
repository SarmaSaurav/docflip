// PandocGui frontend.
//
// The frontend owns the argument list: it shows it live and hands it to the
// Rust side, which only resolves paths and spawns `pandoc`.

const T = window.__TAURI__ || {};
const invoke = T.core?.invoke?.bind(T.core) ?? window.__TAURI_INTERNALS__?.invoke;
const isTauri = typeof invoke === "function";

// --- format tables -------------------------------------------------------

/** Output formats: select value -> writer flag + file extension. */
const FORMATS = {
  docx: { ext: "docx", writer: "docx" },
  gfm: { ext: "md", writer: "gfm" },
  html: { ext: "html", writer: "html" },
  latex: { ext: "tex", writer: "latex" },
  epub: { ext: "epub", writer: "epub" },
  odt: { ext: "odt", writer: "odt" },
  rst: { ext: "rst", writer: "rst" },
};

/** Input extensions we can name in the UI; anything else stays "auto". */
const INPUT_FORMATS = {
  docx: "Word document",
  md: "Markdown",
  markdown: "Markdown",
  txt: "Plain text",
  tex: "LaTeX",
  latex: "LaTeX",
  html: "HTML",
  htm: "HTML",
  epub: "EPUB",
  odt: "OpenDocument text",
  rst: "reStructuredText",
};

const MEDIA_INPUTS = new Set(["docx", "odt", "epub"]);

// --- element lookup ------------------------------------------------------

const $ = (id) => document.getElementById(id);
const el = {
  dropzone: $("dropzone"),
  dzHint: $("dz-hint"),
  dzFile: $("dz-file"),
  dzName: $("dz-name"),
  clearInput: $("clear-input"),
  browseInput: $("browse-input"),
  inputFormat: $("input-format"),
  outFormat: $("out-format"),
  outPath: $("out-path"),
  browseOutput: $("browse-output"),
  optWrap: $("opt-wrap"),
  optStandalone: $("opt-standalone"),
  optToc: $("opt-toc"),
  optExtract: $("opt-extract"),
  optRefDoc: $("opt-refdoc"),
  checkRefDoc: $("check-refdoc"),
  browseRefDoc: $("browse-refdoc"),
  refDocPath: $("refdoc-path"),
  cmdPreview: $("cmd-preview"),
  copyCmd: $("copy-cmd"),
  status: $("status"),
  convert: $("convert"),
  reveal: $("reveal"),
  pandocStatus: $("pandoc-status"),
  dropOverlay: $("drop-overlay"),
};

// --- state ---------------------------------------------------------------

const state = {
  input: "",
  refDoc: "",
  pandocOk: false,
  outPathTouched: false,
  standaloneTouched: false,
  busy: false,
  lastOutput: "",
};

// --- small helpers -------------------------------------------------------

function extensionOf(path) {
  const base = String(path).split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

function basename(path) {
  return String(path).split(/[\\/]/).pop() ?? path;
}

function dirname(path) {
  const s = String(path);
  const i = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
  return i > 0 ? s.slice(0, i) : s;
}

function joinPath(dir, name) {
  const sep = String(dir).includes("\\") ? "\\" : "/";
  return String(dir).replace(/[\\/]+$/, "") + sep + name;
}

/** Same quoting the Rust side uses, so preview == reality. */
function shellQuote(arg) {
  const s = String(arg);
  return /[\s"'&|<>^]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

function replaceExtension(path, ext) {
  const dir = dirname(path);
  const base = basename(path);
  const i = base.lastIndexOf(".");
  const stem = i > 0 ? base.slice(0, i) : base;
  return joinPath(dir, `${stem}.${ext}`);
}

// --- status area ---------------------------------------------------------

function setStatus(kind, text, detail) {
  if (!text) {
    el.status.hidden = true;
    el.status.textContent = "";
    return;
  }
  el.status.hidden = false;
  el.status.className = `status status-${kind}`;
  el.status.replaceChildren();
  const main = document.createElement("div");
  main.textContent = text;
  el.status.appendChild(main);
  if (detail) {
    const pre = document.createElement("pre");
    pre.textContent = detail;
    el.status.appendChild(pre);
  }
}

function setPandocStatus(kind, text, title) {
  el.pandocStatus.className = `pill pill-${kind}`;
  el.pandocStatus.textContent = text;
  el.pandocStatus.title = title || text;
}

// --- backend calls (with a browser-preview fallback) ---------------------

async function call(cmd, args = {}) {
  if (!isTauri) return mockCall(cmd, args);
  return invoke(cmd, args);
}

async function dialogOpen(options) {
  if (!isTauri) return null;
  return invoke("plugin:dialog|open", { options });
}

async function dialogSave(options) {
  if (!isTauri) return null;
  return invoke("plugin:dialog|save", { options });
}

async function dialogConfirm(message, title) {
  if (!isTauri) return window.confirm(message);
  const res = await invoke("plugin:dialog|message", {
    message,
    title,
    kind: "warning",
    buttons: { OkCancelCustom: ["Overwrite", "Cancel"] },
  });
  if (res === false || res === null || res === undefined) return false;
  return String(res).toLowerCase() !== "cancel";
}

/** Lets the UI be previewed in a plain browser with no Rust behind it. */
async function mockCall(cmd, args) {
  switch (cmd) {
    case "check_pandoc":
      return "pandoc 3.9 (browser preview)";
    case "derive_output": {
      const out = replaceExtension(args.input, args.extension);
      // Mirrors src-tauri/src/lib.rs: never point output at the input file.
      if (out === String(args.input)) {
        const dir = dirname(args.input);
        const stem = basename(args.input).replace(/\.[^.]+$/, "");
        return joinPath(dir, `${stem}-converted.${args.extension}`);
      }
      return out;
    }
    case "sibling_path":
      return joinPath(dirname(args.base), args.name);
    case "file_exists":
      return false;
    case "convert":
      return { command: "", warnings: "" };
    default:
      throw new Error(`mock: unknown command ${cmd}`);
  }
}

// --- command construction ------------------------------------------------

function format() {
  return FORMATS[el.outFormat.value];
}

async function buildArgs() {
  const fmt = format();
  const args = ["-t", fmt.writer];
  if (el.optStandalone.checked) args.push("-s");
  if (el.optToc.checked) args.push("--toc");
  if (el.optWrap.checked) args.push("--wrap=none");
  if (el.optExtract.checked && el.outPath.value.trim()) {
    const media = await call("sibling_path", {
      base: el.outPath.value.trim(),
      name: "media",
    });
    args.push(`--extract-media=${media}`);
  }
  if (el.optRefDoc.checked && state.refDoc) {
    args.push(`--reference-doc=${state.refDoc}`);
  }
  return args;
}

async function updatePreview() {
  const token = (updatePreview.token = (updatePreview.token ?? 0) + 1);
  const input = state.input;
  const output = el.outPath.value.trim();
  const args = await buildArgs();
  if (token !== updatePreview.token) return;

  const parts = ["pandoc"];
  if (input) parts.push(shellQuote(input));
  else parts.push("<input>");
  parts.push("-o", output ? shellQuote(output) : "<output>");
  parts.push(...args.map(shellQuote));

  el.cmdPreview.replaceChildren();
  const code = document.createElement("code");
  code.textContent = parts.join(" ");
  el.cmdPreview.appendChild(code);

  const ready = Boolean(input && output) && state.pandocOk && !state.busy;
  el.convert.disabled = !ready;
}

// --- input handling ------------------------------------------------------

async function setInput(path) {
  if (!path) return;
  state.input = path;
  state.outPathTouched = false;

  const ext = extensionOf(path);
  const label = INPUT_FORMATS[ext];
  el.inputFormat.hidden = !ext;
  el.inputFormat.textContent = label
    ? `${ext.toUpperCase()} · ${label}`
    : ext
      ? `.${ext}`
      : "";

  el.dzHint.hidden = true;
  el.dzFile.hidden = false;
  el.dzName.textContent = basename(path);
  el.dzName.title = path;

  // Media extraction only makes sense when images may be embedded in the source.
  el.optExtract.checked = MEDIA_INPUTS.has(ext);

  const output = await call("derive_output", {
    input: path,
    extension: format().ext,
  });
  if (state.input !== path) return; // a newer file was dropped meanwhile
  el.outPath.value = output;
  setStatus(null, "");
  el.reveal.hidden = true;
  await updatePreview();
}

function clearInput() {
  state.input = "";
  state.outPathTouched = false;
  el.dzHint.hidden = false;
  el.dzFile.hidden = true;
  el.inputFormat.hidden = true;
  el.outPath.value = "";
  el.reveal.hidden = true;
  setStatus(null, "");
  updatePreview();
}

async function pickInput() {
  const picked = await dialogOpen({
    multiple: false,
    filters: [
      {
        name: "Documents",
        extensions: Object.keys(INPUT_FORMATS),
      },
    ],
  });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (path) await setInput(path);
}

async function pickOutput() {
  const fmt = format();
  const picked = await dialogSave({
    defaultPath: el.outPath.value.trim() || undefined,
    filters: [{ name: "Output file", extensions: [fmt.ext] }],
  });
  if (picked) {
    el.outPath.value = picked;
    state.outPathTouched = true;
    el.reveal.hidden = true;
    await updatePreview();
  }
}

async function pickRefDoc() {
  const picked = await dialogOpen({
    multiple: false,
    filters: [{ name: "Word/OpenDocument template", extensions: ["docx", "odt"] }],
  });
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (path) {
    state.refDoc = path;
    el.optRefDoc.checked = true;
    el.refDocPath.hidden = false;
    el.refDocPath.textContent = basename(path);
    el.refDocPath.title = path;
    await updatePreview();
  }
}

// --- converting ----------------------------------------------------------

function setBusy(busy) {
  state.busy = busy;
  el.convert.textContent = busy ? "Converting…" : "Convert";
  el.convert.classList.toggle("busy", busy);
  updatePreview();
}

async function convertNow() {
  if (state.busy || !state.input || !state.pandocOk) return;
  const input = state.input;
  const output = el.outPath.value.trim();
  if (!output) {
    setStatus("error", "Choose where to save the output.");
    return;
  }

  setBusy(true);
  el.reveal.hidden = true;
  setStatus("info", `Converting ${basename(input)} → ${basename(output)}…`);

  try {
    const exists = await call("file_exists", { path: output });
    if (exists) {
      const ok = await dialogConfirm(
        `"${output}" already exists. Overwrite it?`,
        "Overwrite file?",
      );
      if (!ok) {
        setStatus("info", "Cancelled — nothing was written.");
        return;
      }
    }

    const args = await buildArgs();
    const result = await call("convert", {
      input,
      output,
      args,
      pandocPath: null,
    });

    state.lastOutput = output;
    el.reveal.hidden = false;

    if (result.warnings) {
      setStatus("warn", `Converted, but pandoc reported warnings:`, result.warnings);
    } else {
      setStatus("ok", `Converted → ${output}`);
    }
  } catch (err) {
    setStatus("error", "Conversion failed.", String(err?.message ?? err));
  } finally {
    setBusy(false);
  }
}

async function revealOutput() {
  if (!state.lastOutput) return;
  try {
    if (isTauri) {
      await invoke("plugin:opener|reveal_item_in_dir", {
        paths: [state.lastOutput],
      });
    }
  } catch (err) {
    setStatus("warn", "Could not open the folder.", String(err?.message ?? err));
  }
}

// --- events --------------------------------------------------------------

el.browseInput.addEventListener("click", (e) => {
  e.stopPropagation();
  pickInput();
});
el.dropzone.addEventListener("click", () => pickInput());
el.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pickInput();
  }
});
el.clearInput.addEventListener("click", (e) => {
  e.stopPropagation();
  clearInput();
});
el.browseOutput.addEventListener("click", pickOutput);
el.browseRefDoc.addEventListener("click", pickRefDoc);

el.outFormat.addEventListener("change", async () => {
  const selected = el.outFormat.value;
  const fmt = format();

  // Keep the output path honest unless the user edited it themselves.
  if (state.input && !state.outPathTouched) {
    const output = await call("derive_output", {
      input: state.input,
      extension: fmt.ext,
    });
    if (el.outFormat.value === selected) el.outPath.value = output;
  }

  // Sensible default for -s: useful for tex/html, noise elsewhere.
  if (!state.standaloneTouched) {
    el.optStandalone.checked = fmt.ext === "tex" || fmt.ext === "html";
  }

  // --reference-doc only exists for docx/odt writers.
  const refDocApplies = fmt.ext === "docx" || fmt.ext === "odt";
  el.checkRefDoc.hidden = !refDocApplies;
  if (!refDocApplies) el.optRefDoc.checked = false;

  await updatePreview();
});

el.outPath.addEventListener("input", () => {
  state.outPathTouched = true;
  el.reveal.hidden = true;
  updatePreview();
});

for (const box of [
  el.optWrap,
  el.optToc,
  el.optExtract,
  el.optRefDoc,
]) {
  box.addEventListener("change", () => {
    if (box === el.optRefDoc && box.checked && !state.refDoc) {
      pickRefDoc();
      return;
    }
    updatePreview();
  });
}
el.optStandalone.addEventListener("change", () => {
  state.standaloneTouched = true;
  updatePreview();
});

el.convert.addEventListener("click", convertNow);
el.reveal.addEventListener("click", revealOutput);

el.copyCmd.addEventListener("click", async () => {
  const text = el.cmdPreview.textContent ?? "";
  try {
    await navigator.clipboard.writeText(text);
    el.copyCmd.textContent = "copied";
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    el.copyCmd.textContent = "copied";
  }
  setTimeout(() => (el.copyCmd.textContent = "copy"), 1200);
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || state.busy) return;
  const t = e.target;
  if (t === el.dropzone) return; // the dropzone opens the picker itself
  if (t instanceof HTMLButtonElement || t instanceof HTMLSelectElement) return;
  e.preventDefault();
  convertNow();
});

// --- drag and drop -------------------------------------------------------

function setOverlay(show) {
  el.dropOverlay.hidden = !show;
  el.dropzone.classList.toggle("dropping", show);
}

async function setupDragDrop() {
  if (!isTauri || !T.webview?.getCurrentWebview) {
    // Plain browser: use the HTML5 events so the UI can still be previewed.
    document.addEventListener("dragover", (e) => {
      e.preventDefault();
      setOverlay(true);
    });
    document.addEventListener("dragleave", (e) => {
      if (e.relatedTarget === null) setOverlay(false);
    });
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      setOverlay(false);
      const path = e.dataTransfer?.files?.[0]?.path;
      if (path) setInput(path);
    });
    return;
  }

  const webview = T.webview.getCurrentWebview();
  await webview.onDragDropEvent((event) => {
    const payload = event.payload ?? {};
    if (payload.type === "enter" || payload.type === "over") {
      setOverlay(true);
    } else if (payload.type === "leave") {
      setOverlay(false);
    } else if (payload.type === "drop") {
      setOverlay(false);
      const paths = payload.paths ?? [];
      if (paths.length) setInput(paths[0]);
    }
  });
}

// --- startup -------------------------------------------------------------

async function checkPandoc() {
  try {
    const version = await call("check_pandoc", { pandocPath: null });
    state.pandocOk = true;
    setPandocStatus("ok", version, version);
    setStatus(null, "");
  } catch (err) {
    state.pandocOk = false;
    const message = String(err?.message ?? err);
    setPandocStatus("error", "pandoc not found", message);
    setStatus("error", "Pandoc is not installed (or not on PATH).", message);
  }
}

async function init() {
  // Defaults that match the common paths in the plan's cheat sheet.
  el.optStandalone.checked = false;
  await checkPandoc();
  await setupDragDrop();
  await updatePreview();
}

init();
