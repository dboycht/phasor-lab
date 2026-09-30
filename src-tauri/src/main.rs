// Phasor Lab - desktop shell.
//
// The whole application is the static bundle in ../dist, which `generate_context!`
// embeds into this binary at compile time, so the executable is self-contained
// (it only needs the WebView2 runtime that Windows 10/11 already ship).

// no console window behind the app in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to start Phasor Lab");
}
