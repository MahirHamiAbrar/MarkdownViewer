# TODO

- [ ] **Direct PDF export on Windows and macOS**: they still go through the system print dialog.
  Use WebView2 `PrintToPdf` and WKWebView `createPDF` (`export_pdf` in `src-tauri/src/lib.rs`).
- [ ] **DOCX export and viewer**.
- [ ] **Plugin support**: let third-party plugins extend the app (renderers, commands, panels).
- [ ] **Settings redesign**: sidebar tabs plus a global search across every setting (like KDE System Settings).
