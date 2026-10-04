fn main() {
    // アプリ独自コマンドを明示し、capabilitiesで許可したものだけを呼べるようにする
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "list_projects",
            "load_project",
            "create_project",
            "save_project",
            "put_asset",
            "get_asset",
            "gc_assets",
            "delete_project",
            "delete_all",
            "storage_usage",
            "record_export",
            "save_export",
        ]),
    ))
    .expect("failed to run tauri-build");
}
