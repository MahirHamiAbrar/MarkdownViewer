//! "GPU acceleration" setting (Linux). WebKitGTK only uses the GPU through its DMA-BUF renderer,
//! and that choice is made from environment variables before the webview starts, so the setting
//! lives in a small file read at launch and a change applies on restart. See docs/BLUR.md.

use std::path::PathBuf;
use std::sync::OnceLock;

use serde::Serialize;

/// What this launch ended up with: (saved mode, GPU path on).
static ACTIVE: OnceLock<(String, bool)> = OnceLock::new();

fn config_file() -> Option<PathBuf> {
    // Same folder as fsutil::app_dir; no AppHandle exists this early.
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".markdowneditor").join("gpu"))
}

fn saved_mode() -> String {
    let mode = config_file().and_then(|f| std::fs::read_to_string(f).ok()).unwrap_or_default();
    match mode.trim() {
        "on" | "off" => mode.trim().to_string(),
        _ => "auto".into(),
    }
}

fn is_nvidia() -> bool {
    std::path::Path::new("/proc/driver/nvidia").exists()
}

/// Sets WebKitGTK's renderer variables for this launch. Call before any thread or webview starts.
/// A value already in the environment wins over the setting.
pub fn apply_env() {
    let mode = saved_mode();
    let on = match mode.as_str() {
        "on" => true,
        "off" => false,
        // Auto: off on the NVIDIA proprietary driver. WebKitGTK blocks the renderer there, and forcing it
        // gave a blank window on X11 and choppier preview scrolling than the CPU on Wayland.
        _ => !is_nvidia(),
    };
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() && std::env::var_os("WEBKIT_FORCE_DMABUF_RENDERER").is_none() {
        if on {
            // WebKitGTK turns the renderer off by itself on NVIDIA; forcing it works on Wayland.
            if is_nvidia() {
                std::env::set_var("WEBKIT_FORCE_DMABUF_RENDERER", "1");
            }
        } else {
            // Software rendering launches faster but scrolls and animates on the CPU.
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    let _ = ACTIVE.set((mode, on));
}

#[derive(Serialize)]
pub struct GpuStatus {
    supported: bool,
    mode: String,
    active: bool,
}

#[tauri::command]
pub fn gpu_status() -> GpuStatus {
    let (mode, active) = ACTIVE.get().cloned().unwrap_or(("auto".into(), true));
    GpuStatus { supported: cfg!(target_os = "linux"), mode, active }
}

#[tauri::command(async)]
pub fn gpu_set(mode: String) -> Result<(), String> {
    if !["auto", "on", "off"].contains(&mode.as_str()) {
        return Err("Invalid mode.".into());
    }
    let file = config_file().ok_or("No home folder.")?;
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    crate::fsutil::atomic_write(&file, mode.as_bytes(), false).map_err(|e| e.to_string())
}
