//! Tappivra Windowsエディター（Tauri 2）。
//! IPCはプロジェクト単位の限定コマンドのみ。任意SQL・任意パス読み取り・shell実行は公開しない。
pub mod store;

#[cfg(test)]
mod store_tests;

use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::sync::Mutex;
use store::{AssetMeta, LoadedProject, ProjectSummary, Store, StoreError, Usage};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    store: Mutex<Store>,
}

type CmdResult<T> = Result<T, String>;

fn err(e: StoreError) -> String {
    e.to_string()
}

fn with_store<T>(state: &State<'_, AppState>, f: impl FnOnce(&mut Store) -> store::Result<T>) -> CmdResult<T> {
    let mut s = state.store.lock().map_err(|_| "STORAGE: データベースを利用できません".to_string())?;
    f(&mut s).map_err(err)
}

fn raw_body<'a>(req: &'a Request<'_>) -> CmdResult<&'a [u8]> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b.as_slice()),
        _ => Err("INVALID: バイナリデータが必要です".into()),
    }
}

fn header(req: &Request<'_>, name: &str) -> CmdResult<String> {
    let v = req.headers().get(name).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("INVALID: {name}がありません"))?;
    percent_decode_str(v).decode_utf8().map(|s| s.into_owned()).map_err(|_| "INVALID: ヘッダーが不正です".into())
}

#[tauri::command]
fn list_projects(state: State<'_, AppState>) -> CmdResult<Vec<ProjectSummary>> {
    with_store(&state, |s| s.list_projects())
}

#[tauri::command]
fn load_project(state: State<'_, AppState>, project_id: String) -> CmdResult<LoadedProject> {
    with_store(&state, |s| s.load_project(&project_id))
}

#[tauri::command]
fn create_project(state: State<'_, AppState>, request: Request<'_>) -> CmdResult<i64> {
    let (graph_json, assets) = store::parse_create_body(raw_body(&request)?).map_err(err)?;
    let v: serde_json::Value = serde_json::from_str(&graph_json).map_err(|_| "INVALID: 編集データが不正です".to_string())?;
    let pid = v.pointer("/project/id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    with_store(&state, |s| s.create_project(&pid, &graph_json, &assets))
}

#[tauri::command]
fn save_project(state: State<'_, AppState>, project_id: String, expected_revision: i64, graph_json: String) -> CmdResult<i64> {
    with_store(&state, |s| s.save_project(&project_id, expected_revision, &graph_json))
}

#[tauri::command]
fn put_asset(state: State<'_, AppState>, request: Request<'_>) -> CmdResult<()> {
    let meta: AssetMeta = serde_json::from_str(&header(&request, "x-tappivra-meta")?).map_err(|_| "INVALID: 画像情報が不正です".to_string())?;
    let data = raw_body(&request)?;
    with_store(&state, |s| s.put_asset(&meta, data))
}

#[tauri::command]
fn get_asset(state: State<'_, AppState>, project_id: String, asset_id: String) -> CmdResult<Response> {
    with_store(&state, |s| s.get_asset(&project_id, &asset_id)).map(Response::new)
}

#[tauri::command]
fn gc_assets(state: State<'_, AppState>, project_id: String, keep: Vec<String>) -> CmdResult<usize> {
    with_store(&state, |s| s.gc_assets(&project_id, &keep))
}

#[tauri::command]
fn delete_project(state: State<'_, AppState>, project_id: String) -> CmdResult<()> {
    with_store(&state, |s| s.delete_project(&project_id))
}

#[tauri::command]
fn delete_all(state: State<'_, AppState>, confirm_text: String) -> CmdResult<()> {
    with_store(&state, |s| s.delete_all(&confirm_text))
}

#[tauri::command]
fn storage_usage(state: State<'_, AppState>) -> CmdResult<Usage> {
    with_store(&state, |s| s.usage())
}

#[tauri::command]
fn record_export(state: State<'_, AppState>, project_id: String, record_json: String) -> CmdResult<()> {
    with_store(&state, |s| s.record_export(&project_id, &record_json))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveResult {
    saved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
}

/// 書き出し：保存先はRust側のダイアログでユーザーが選ぶ（フロントからパスを受け取らない）。
#[tauri::command]
async fn save_export(app: tauri::AppHandle, request: Request<'_>) -> CmdResult<SaveResult> {
    let kind = header(&request, "x-tappivra-kind")?;
    let name = store::sanitize_export_name(&kind, &header(&request, "x-tappivra-name")?).map_err(err)?;
    let data = raw_body(&request)?.to_vec();
    let (label, ext) = match kind.as_str() {
        "html" => ("閲覧用HTML", "html"),
        "demo-zip" => ("閲覧用ZIP", "zip"),
        _ => ("編集用バックアップZIP", "zip"),
    };
    let dialog = app.dialog().file().set_file_name(&name).add_filter(label, &[ext]);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|_| "STORAGE: 保存ダイアログを開けませんでした".to_string())?;
    let Some(fp) = picked else {
        return Ok(SaveResult { saved: false, file_name: None });
    };
    let path = fp.into_path().map_err(|_| "INVALID: 保存先が不正です".to_string())?;
    let file_name = path.file_name().and_then(|s| s.to_str()).map(String::from);
    tauri::async_runtime::spawn_blocking(move || store::write_atomic(&path, &data))
        .await
        .map_err(|_| "STORAGE: 保存できませんでした".to_string())?
        .map_err(|e| format!("STORAGE: 保存先に書き込めませんでした（{e}）"))?;
    Ok(SaveResult { saved: true, file_name })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 多重起動は既存ウィンドウへ誘導（同じDBを2プロセスで編集させない）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let store = Store::open(&dir.join("tappivra.sqlite3")).map_err(|e| e.to_string())?;
            app.manage(AppState { store: Mutex::new(store) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            load_project,
            create_project,
            save_project,
            put_asset,
            get_asset,
            gc_assets,
            delete_project,
            delete_all,
            storage_usage,
            record_export,
            save_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tappivra");
}
