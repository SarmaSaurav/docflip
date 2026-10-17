use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Don't flash a console window when spawning pandoc on Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const INSTALL_HINT_WIN: &str = "winget install JohnMacFarlane.Pandoc";
const INSTALL_HINT_LINUX: &str = "sudo apt install pandoc";

/// Builds a command that never shows a console window on Windows.
fn command(program: &str) -> Command {
    // `mut` is only used below on Windows (creation_flags).
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// The configured pandoc program: an explicit path from settings, or `pandoc` on PATH.
fn pandoc_program(pandoc_path: Option<String>) -> String {
    match pandoc_path {
        Some(p) if !p.trim().is_empty() => p,
        _ => "pandoc".to_string(),
    }
}

fn not_found_message(program: &str) -> String {
    if program == "pandoc" {
        format!(
            "Pandoc was not found on PATH. Install it with `{INSTALL_HINT_WIN}` (Windows) \
             or `{INSTALL_HINT_LINUX}` (Linux), then restart PandocGui."
        )
    } else {
        format!("Could not start `{program}`. Check the pandoc path in the app settings.")
    }
}

/// Absolute path for something the frontend may have given us as relative.
fn absolutize(path: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(path);
    if p.is_absolute() {
        Ok(p)
    } else {
        let cwd = std::env::current_dir().map_err(|e| format!("Cannot resolve path: {e}"))?;
        Ok(cwd.join(p))
    }
}

/// Reports the pandoc version so the UI can show a clear "not installed" message.
#[tauri::command]
fn check_pandoc(pandoc_path: Option<String>) -> Result<String, String> {
    let program = pandoc_program(pandoc_path);
    let output = command(&program)
        .arg("--version")
        .stdin(Stdio::null())
        .output()
        .map_err(|_| not_found_message(&program))?;

    if output.status.success() {
        let first = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .unwrap_or("pandoc")
            .trim()
            .to_string();
        Ok(first)
    } else {
        Err(format!(
            "`{program}` ran but did not work: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

/// Where a conversion should write: same folder, new extension.
///
/// Same-format conversions (docx -> docx) would land on the source file, so a
/// suffix is added instead of silently pointing output at the input.
#[tauri::command]
fn derive_output(input: String, extension: String) -> Result<String, String> {
    let input = absolutize(&input)?;
    let extension = extension.trim_start_matches('.');
    let mut output = input.with_extension(extension);

    if output == input {
        let stem = input.file_stem().unwrap_or_default().to_string_lossy();
        let suffix = format!("{stem}-converted.{extension}");
        output = input.with_file_name(suffix);
    }

    Ok(output.to_string_lossy().into_owned())
}

/// A path in the same folder as `base` — used for `--extract-media`.
#[tauri::command]
fn sibling_path(base: String, name: String) -> Result<String, String> {
    let base = absolutize(&base)?;
    let dir = base.parent().ok_or_else(|| "Cannot resolve folder".to_string())?;
    Ok(dir.join(name).to_string_lossy().into_owned())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[derive(serde::Serialize, Debug)]
struct ConvertOutcome {
    /// The exact command that was run, for the status area.
    command: String,
    /// Warnings pandoc wrote to stderr, empty on a quiet run.
    warnings: String,
}

/// Runs `pandoc <input> -o <output> <args...>`.
///
/// The frontend owns the argument list (it also shows it as a live preview);
/// this side only resolves paths, spawns the process and surfaces stderr.
#[tauri::command]
fn convert(
    input: String,
    output: String,
    args: Vec<String>,
    pandoc_path: Option<String>,
) -> Result<ConvertOutcome, String> {
    let input_path = absolutize(&input)?;
    let output_path = absolutize(&output)?;

    if !input_path.is_file() {
        return Err(format!("Input file not found: {}", input_path.display()));
    }
    if input_path == output_path {
        return Err(
            "The output is the same file as the input — pick a different output path.".to_string(),
        );
    }

    let output_dir = output_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| format!("Cannot resolve output folder for: {}", output_path.display()))?;
    if !output_dir.is_dir() {
        return Err(format!(
            "Output folder does not exist: {}",
            output_dir.display()
        ));
    }

    let program = pandoc_program(pandoc_path);
    let mut cmd = command(&program);
    cmd.arg(&input_path)
        .arg("-o")
        .arg(&output_path)
        .args(&args)
        .current_dir(output_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|_| not_found_message(&program))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let command_line = format!(
        "{} {} {}",
        program,
        shell_quote(&input_path.to_string_lossy()),
        rest_of_command(&output_path.to_string_lossy(), &args)
    );

    if !output.status.success() {
        let detail = if stderr.trim().is_empty() {
            if stdout.trim().is_empty() {
                format!("pandoc exited with {}", output.status)
            } else {
                stdout.trim().to_string()
            }
        } else {
            stderr.trim().to_string()
        };
        return Err(detail);
    }

    if !output_path.is_file() {
        return Err(format!(
            "pandoc reported success but wrote no file at {}",
            output_path.display()
        ));
    }

    Ok(ConvertOutcome {
        command: command_line,
        warnings: stderr.trim().to_string(),
    })
}

fn rest_of_command(output: &str, args: &[String]) -> String {
    let mut parts = vec!["-o".to_string(), shell_quote(output)];
    parts.extend(args.iter().map(|a| shell_quote(a)));
    parts.join(" ")
}

/// Minimal quoting so the preview/status copy-pastes correctly.
fn shell_quote(arg: &str) -> String {
    if arg.chars().any(|c| c.is_whitespace() || "\"'&|<>^".contains(c)) {
        format!("\"{}\"", arg.replace('"', "\\\""))
    } else {
        arg.to_string()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            check_pandoc,
            convert,
            derive_output,
            sibling_path,
            file_exists
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fresh, isolated folder per test (removed first so reruns are clean).
    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pandocgui-tests-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn has_pandoc() -> bool {
        check_pandoc(None).is_ok()
    }

    #[test]
    fn derive_output_swaps_the_extension() {
        let dir = temp_dir("derive");
        let input = dir.join("notes.md");
        std::fs::write(&input, "# hi").unwrap();

        let out = derive_output(input.to_string_lossy().into(), "docx".into()).unwrap();
        assert_eq!(PathBuf::from(&out), dir.join("notes.docx"));
    }

    #[test]
    fn derive_output_never_points_at_the_input() {
        let dir = temp_dir("derive-same");
        let input = dir.join("report.docx");
        std::fs::write(&input, "x").unwrap();

        let out = derive_output(input.to_string_lossy().into(), "docx".into()).unwrap();
        assert_eq!(PathBuf::from(&out), dir.join("report-converted.docx"));
    }

    #[test]
    fn quoting_handles_spaces() {
        assert_eq!(shell_quote("plain.md"), "plain.md");
        assert_eq!(shell_quote("my notes.md"), "\"my notes.md\"");
    }

    #[test]
    fn refuses_to_overwrite_the_input() {
        let dir = temp_dir("reject");
        let input = dir.join("same.md");
        std::fs::write(&input, "# hi").unwrap();

        let err = convert(
            input.to_string_lossy().into(),
            input.to_string_lossy().into(),
            vec![],
            None,
        )
        .unwrap_err();
        assert!(err.contains("same file"), "{err}");
    }

    #[test]
    fn converts_markdown_to_html_with_pandoc() {
        if !has_pandoc() {
            return; // environment without pandoc: skip, not a failure
        }
        let dir = temp_dir("convert");
        let input = dir.join("in.md");
        std::fs::write(&input, "# Title\n\nHello *world*.\n").unwrap();
        let output = dir.join("out.html");

        let outcome = convert(
            input.to_string_lossy().into(),
            output.to_string_lossy().into(),
            vec!["-t".into(), "html".into(), "-s".into()],
            None,
        )
        .expect("conversion should succeed");

        let html = std::fs::read_to_string(&output).expect("output written");
        assert!(html.contains("<h1"), "{html}");
        // Deliberately not asserting `warnings.is_empty()`: pandoc versions differ
        // in benign notes for `-s` HTML (e.g. "requires a nonempty <title> element"),
        // which is a warning to show the user, not a failure to test away.
        assert!(outcome.command.contains("-t html"), "{}", outcome.command);
    }

    #[test]
    fn reports_stderr_when_pandoc_fails() {
        if !has_pandoc() {
            return;
        }
        let dir = temp_dir("fail");
        let input = dir.join("in.md");
        std::fs::write(&input, "# hi").unwrap();
        let output = dir.join("out.html");

        let err = convert(
            input.to_string_lossy().into(),
            output.to_string_lossy().into(),
            vec!["-t".into(), "definitely-not-a-format".into()],
            None,
        )
        .unwrap_err();
        assert!(!err.trim().is_empty(), "stderr should be surfaced");
        assert!(!output.exists(), "no file should be written");
    }

    #[test]
    fn runs_from_paths_with_spaces_and_unicode() {
        if !has_pandoc() {
            return;
        }
        let dir = temp_dir("spaces and ünicode");
        let input = dir.join("my notes.md");
        std::fs::write(&input, "# नमस्ते\n").unwrap();
        let output = dir.join("my notes.html");

        convert(
            input.to_string_lossy().into(),
            output.to_string_lossy().into(),
            vec!["-t".into(), "html".into()],
            None,
        )
        .expect("conversion with spaces/unicode in paths");

        assert!(output.is_file());
    }
}
