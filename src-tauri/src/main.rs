#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer added ~0.5 s CPU plus seconds of GL work to launch (measured on
    // Intel/Wayland). Set before any thread starts; an explicit value in the environment still wins.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    markdowneditor_lib::run()
}
