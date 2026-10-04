//! アプリ専用ローカルDB（rusqlite / bundled SQLite）。
//! Tauriに依存しない純粋なモジュールとし、cargo testで直接検証する。
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub const SCHEMA_VERSION: i64 = 1;
pub const MAX_GRAPH_JSON: usize = 2 * 1024 * 1024;
pub const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_STEPS: usize = 30;
pub const DELETE_ALL_PHRASE: &str = "すべて削除";

#[derive(Debug)]
pub enum StoreError {
    Conflict,
    Invalid(String),
    NotFound(String),
    Db(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Conflict => write!(f, "CONFLICT: 他の編集内容と競合しました"),
            StoreError::Invalid(m) => write!(f, "INVALID: {m}"),
            StoreError::NotFound(m) => write!(f, "NOT_FOUND: {m}"),
            StoreError::Db(m) => write!(f, "STORAGE: 保存できませんでした（{m}）"),
        }
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(e: rusqlite::Error) -> Self {
        StoreError::Db(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, StoreError>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetMeta {
    pub id: String,
    pub project_id: String,
    pub mime: String,
    pub width: i64,
    pub height: i64,
    pub byte_length: i64,
    pub sha256: String,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub revision: i64,
    pub updated_at: String,
    pub step_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_backup_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_asset_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedProject {
    pub revision: i64,
    pub graph_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub projects: i64,
    pub bytes: i64,
    pub location: String,
}

/// UUID（小文字、RFC 4122形式）の検証
pub fn is_uuid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (i, c) in b.iter().enumerate() {
        let ok = match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(c),
        };
        if !ok {
            return false;
        }
    }
    true
}

fn require_uuid(s: &str, what: &str) -> Result<()> {
    if is_uuid(s) {
        Ok(())
    } else {
        Err(StoreError::Invalid(format!("{what}のIDが不正です")))
    }
}

pub fn sha256_hex(data: &[u8]) -> String {
    let d = Sha256::digest(data);
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/// 画像の実バイトがmimeと一致するか（PNG/JPEGのみ）
pub fn magic_matches(mime: &str, data: &[u8]) -> bool {
    match mime {
        "image/png" => data.starts_with(&[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        "image/jpeg" => data.starts_with(&[0xff, 0xd8, 0xff]),
        _ => false,
    }
}

fn now_iso() -> String {
    // SQLiteのUTC時刻（ISO8601）
    let conn = Connection::open_in_memory().ok();
    conn.and_then(|c| c.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |r| r.get::<_, String>(0)).ok())
        .unwrap_or_else(|| "1970-01-01T00:00:00Z".into())
}

pub struct Store {
    conn: Connection,
    path: Option<PathBuf>,
}

/// グラフJSONの最低限の検証：project.idの一致、ステップ数、assets一覧
fn inspect_graph(project_id: &str, graph_json: &str) -> Result<Value> {
    if graph_json.len() > MAX_GRAPH_JSON {
        return Err(StoreError::Invalid("編集データが大きすぎます".into()));
    }
    let v: Value = serde_json::from_str(graph_json).map_err(|_| StoreError::Invalid("編集データを読み込めません".into()))?;
    let pid = v.pointer("/project/id").and_then(Value::as_str).unwrap_or("");
    if pid != project_id {
        return Err(StoreError::Invalid("プロジェクトIDが一致しません".into()));
    }
    let steps = v.pointer("/project/stepOrder").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0);
    if steps > MAX_STEPS {
        return Err(StoreError::Invalid("ステップ数が上限を超えています".into()));
    }
    if v.pointer("/project/name").and_then(Value::as_str).is_none() {
        return Err(StoreError::Invalid("デモ名がありません".into()));
    }
    Ok(v)
}

fn graph_asset_ids(v: &Value) -> Vec<String> {
    v.get("assets").and_then(Value::as_object).map(|m| m.keys().cloned().collect()).unwrap_or_default()
}

impl Store {
    pub fn open(path: &Path) -> Result<Store> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| StoreError::Db(e.to_string()))?;
        }
        let existed = path.exists();
        let conn = Connection::open(path)?;
        let mut s = Store { conn, path: Some(path.to_path_buf()) };
        s.migrate(existed)?;
        Ok(s)
    }

    pub fn open_in_memory() -> Result<Store> {
        let conn = Connection::open_in_memory()?;
        let mut s = Store { conn, path: None };
        s.migrate(false)?;
        Ok(s)
    }

    fn migrate(&mut self, existed: bool) -> Result<()> {
        self.conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        if self.path.is_some() {
            self.conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
        }
        let ver: i64 = self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if ver > SCHEMA_VERSION {
            return Err(StoreError::Invalid("新しいバージョンのデータです。対応版をご確認ください".into()));
        }
        if ver == SCHEMA_VERSION {
            return Ok(());
        }
        // マイグレーション前にDBコピーを取る（既存DBのみ）
        if existed && ver > 0 {
            if let Some(p) = &self.path {
                let backup = p.with_extension(format!("v{ver}.bak"));
                self.conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
                std::fs::copy(p, &backup).map_err(|e| StoreError::Db(format!("移行前のバックアップに失敗: {e}")))?;
            }
        }
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Exclusive)?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS projects(
                id TEXT PRIMARY KEY,
                revision INTEGER NOT NULL CHECK(revision >= 1),
                graph_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assets(
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                sha256 TEXT NOT NULL,
                mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                data BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS assets_project ON assets(project_id);
            CREATE TABLE IF NOT EXISTS exports(
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                project_revision INTEGER NOT NULL,
                metadata_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings(
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );",
        )?;
        tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        tx.commit()?;
        Ok(())
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>> {
        let mut st = self.conn.prepare("SELECT id, revision, graph_json, updated_at FROM projects ORDER BY updated_at DESC")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))?;
        let mut out = Vec::new();
        for row in rows {
            let (id, revision, json, updated_at) = row?;
            let v: Value = serde_json::from_str(&json).unwrap_or(Value::Null);
            let order = v.pointer("/project/stepOrder").and_then(Value::as_array).cloned().unwrap_or_default();
            let thumb = order
                .first()
                .and_then(Value::as_str)
                .and_then(|sid| v.pointer(&format!("/steps/{sid}/imageAssetId")))
                .and_then(Value::as_str)
                .map(String::from);
            out.push(ProjectSummary {
                id,
                name: v.pointer("/project/name").and_then(Value::as_str).unwrap_or("（名称不明）").to_string(),
                revision,
                updated_at,
                step_count: order.len(),
                last_backup_at: v.pointer("/project/lastBackupAt").and_then(Value::as_str).map(String::from),
                thumb_asset_id: thumb,
            });
        }
        Ok(out)
    }

    pub fn load_project(&self, project_id: &str) -> Result<LoadedProject> {
        require_uuid(project_id, "プロジェクト")?;
        self.conn
            .query_row("SELECT revision, graph_json FROM projects WHERE id=?1", params![project_id], |r| {
                Ok(LoadedProject { revision: r.get(0)?, graph_json: r.get(1)? })
            })
            .optional()?
            .ok_or_else(|| StoreError::NotFound("プロジェクトが見つかりません".into()))
    }

    fn validate_asset(meta: &AssetMeta, data: &[u8]) -> Result<()> {
        require_uuid(&meta.id, "画像")?;
        require_uuid(&meta.project_id, "プロジェクト")?;
        if data.is_empty() || data.len() > MAX_ASSET_BYTES || data.len() as i64 != meta.byte_length {
            return Err(StoreError::Invalid("画像の容量が不正です".into()));
        }
        if !magic_matches(&meta.mime, data) {
            return Err(StoreError::Invalid("画像の形式が不正です".into()));
        }
        if sha256_hex(data) != meta.sha256 {
            return Err(StoreError::Invalid("画像のハッシュが一致しません".into()));
        }
        if meta.width < 1 || meta.height < 1 || meta.width > 2560 || meta.height > 2560 {
            return Err(StoreError::Invalid("画像の寸法が不正です".into()));
        }
        Ok(())
    }

    /// 新規プロジェクトと画像を1トランザクションで登録
    pub fn create_project(&mut self, project_id: &str, graph_json: &str, assets: &[(AssetMeta, Vec<u8>)]) -> Result<i64> {
        require_uuid(project_id, "プロジェクト")?;
        inspect_graph(project_id, graph_json)?;
        for (m, d) in assets {
            Self::validate_asset(m, d)?;
            if m.project_id != project_id {
                return Err(StoreError::Invalid("画像の所属が不正です".into()));
            }
        }
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)", params![project_id], |r| r.get(0))?;
        if exists {
            return Err(StoreError::Invalid("同じIDのプロジェクトが既にあります".into()));
        }
        tx.execute("INSERT INTO projects(id, revision, graph_json, updated_at) VALUES(?1, 1, ?2, ?3)", params![project_id, graph_json, now_iso()])?;
        for (m, d) in assets {
            tx.execute(
                "INSERT INTO assets(id, project_id, sha256, mime, width, height, data) VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![m.id, m.project_id, m.sha256, m.mime, m.width, m.height, d],
            )?;
        }
        tx.commit()?;
        Ok(1)
    }

    /// revisionが一致する場合のみ保存（古い編集で上書きしない）
    pub fn save_project(&mut self, project_id: &str, expected_revision: i64, graph_json: &str) -> Result<i64> {
        require_uuid(project_id, "プロジェクト")?;
        let v = inspect_graph(project_id, graph_json)?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let cur: Option<i64> = tx.query_row("SELECT revision FROM projects WHERE id=?1", params![project_id], |r| r.get(0)).optional()?;
        let cur = cur.ok_or_else(|| StoreError::NotFound("プロジェクトが見つかりません".into()))?;
        if cur != expected_revision {
            return Err(StoreError::Conflict);
        }
        for aid in graph_asset_ids(&v) {
            require_uuid(&aid, "画像")?;
            let owner: Option<String> = tx.query_row("SELECT project_id FROM assets WHERE id=?1", params![aid], |r| r.get(0)).optional()?;
            if owner.as_deref() != Some(project_id) {
                return Err(StoreError::Invalid("画像の所属が不正です".into()));
            }
        }
        let next = cur + 1;
        tx.execute("UPDATE projects SET revision=?2, graph_json=?3, updated_at=?4 WHERE id=?1", params![project_id, next, graph_json, now_iso()])?;
        tx.commit()?;
        Ok(next)
    }

    pub fn put_asset(&mut self, meta: &AssetMeta, data: &[u8]) -> Result<()> {
        Self::validate_asset(meta, data)?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let exists: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM projects WHERE id=?1)", params![meta.project_id], |r| r.get(0))?;
        if !exists {
            return Err(StoreError::NotFound("プロジェクトが見つかりません".into()));
        }
        let owner: Option<String> = tx.query_row("SELECT project_id FROM assets WHERE id=?1", params![meta.id], |r| r.get(0)).optional()?;
        if let Some(o) = owner {
            if o != meta.project_id {
                return Err(StoreError::Invalid("画像の所属が不正です".into()));
            }
            return Ok(()); // 同一内容（IDはsha付きで新規発行される）
        }
        tx.execute(
            "INSERT INTO assets(id, project_id, sha256, mime, width, height, data) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![meta.id, meta.project_id, meta.sha256, meta.mime, meta.width, meta.height, data],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn get_asset(&self, project_id: &str, asset_id: &str) -> Result<Vec<u8>> {
        require_uuid(project_id, "プロジェクト")?;
        require_uuid(asset_id, "画像")?;
        self.conn
            .query_row("SELECT data FROM assets WHERE id=?1 AND project_id=?2", params![asset_id, project_id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| StoreError::NotFound("画像が見つかりません".into()))
    }

    /// 参照されなくなった画像を削除（keep以外）。現在の保存グラフが参照する画像は必ず残す。
    pub fn gc_assets(&mut self, project_id: &str, keep: &[String]) -> Result<usize> {
        require_uuid(project_id, "プロジェクト")?;
        let tx = self.conn.transaction()?;
        let json: Option<String> = tx.query_row("SELECT graph_json FROM projects WHERE id=?1", params![project_id], |r| r.get(0)).optional()?;
        let mut keep_all: Vec<String> = keep.to_vec();
        if let Some(j) = json {
            if let Ok(v) = serde_json::from_str::<Value>(&j) {
                keep_all.extend(graph_asset_ids(&v));
            }
        }
        let ids: Vec<String> = {
            let mut st = tx.prepare("SELECT id FROM assets WHERE project_id=?1")?;
            let rows = st.query_map(params![project_id], |r| r.get::<_, String>(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        let mut n = 0;
        for id in ids {
            if !keep_all.contains(&id) {
                n += tx.execute("DELETE FROM assets WHERE id=?1 AND project_id=?2", params![id, project_id])?;
            }
        }
        tx.commit()?;
        Ok(n)
    }

    pub fn delete_project(&mut self, project_id: &str) -> Result<()> {
        require_uuid(project_id, "プロジェクト")?;
        let n = self.conn.execute("DELETE FROM projects WHERE id=?1", params![project_id])?;
        if n == 0 {
            return Err(StoreError::NotFound("プロジェクトが見つかりません".into()));
        }
        Ok(())
    }

    pub fn delete_all(&mut self, confirm: &str) -> Result<()> {
        if confirm != DELETE_ALL_PHRASE {
            return Err(StoreError::Invalid("確認の文字が一致しません".into()));
        }
        let tx = self.conn.transaction()?;
        tx.execute_batch("DELETE FROM exports; DELETE FROM assets; DELETE FROM projects;")?;
        tx.commit()?;
        self.conn.execute_batch("VACUUM;")?;
        Ok(())
    }

    pub fn usage(&self) -> Result<Usage> {
        let projects: i64 = self.conn.query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))?;
        let bytes: i64 = self.conn.query_row(
            "SELECT COALESCE((SELECT SUM(LENGTH(data)) FROM assets),0) + COALESCE((SELECT SUM(LENGTH(graph_json)) FROM projects),0)",
            [],
            |r| r.get(0),
        )?;
        let location = self.path.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "（メモリー）".into());
        Ok(Usage { projects, bytes, location })
    }

    pub fn record_export(&mut self, project_id: &str, record_json: &str) -> Result<()> {
        require_uuid(project_id, "プロジェクト")?;
        let v: Value = serde_json::from_str(record_json).map_err(|_| StoreError::Invalid("出力記録が不正です".into()))?;
        let id = v.get("id").and_then(Value::as_str).unwrap_or("");
        require_uuid(id, "出力記録")?;
        if v.get("projectId").and_then(Value::as_str) != Some(project_id) {
            return Err(StoreError::Invalid("出力記録の所属が不正です".into()));
        }
        let file_name = v.get("fileName").and_then(Value::as_str).unwrap_or("");
        if file_name.contains('/') || file_name.contains('\\') || file_name.contains(':') {
            return Err(StoreError::Invalid("出力記録に絶対パスは保存できません".into()));
        }
        let rev = v.get("projectRevision").and_then(Value::as_i64).unwrap_or(0);
        self.conn.execute(
            "INSERT INTO exports(id, project_id, project_revision, metadata_json) VALUES(?1,?2,?3,?4)",
            params![id, project_id, rev, record_json],
        )?;
        Ok(())
    }
}

/// create_projectの一括IPC形式を分解：[u32le JSON長][JSON][画像bytes...]
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateHeader {
    graph_json: String,
    assets: Vec<CreateAsset>,
}
#[derive(Deserialize)]
struct CreateAsset {
    meta: AssetMeta,
    length: usize,
}

pub fn parse_create_body(body: &[u8]) -> Result<(String, Vec<(AssetMeta, Vec<u8>)>)> {
    let bad = || StoreError::Invalid("登録データが不正です".into());
    if body.len() < 4 {
        return Err(bad());
    }
    let hlen = u32::from_le_bytes([body[0], body[1], body[2], body[3]]) as usize;
    if hlen > MAX_GRAPH_JSON * 2 || 4 + hlen > body.len() {
        return Err(bad());
    }
    let header: CreateHeader = serde_json::from_slice(&body[4..4 + hlen]).map_err(|_| bad())?;
    let mut off = 4 + hlen;
    let mut assets = Vec::new();
    for a in header.assets {
        if a.length > MAX_ASSET_BYTES || off + a.length > body.len() {
            return Err(bad());
        }
        assets.push((a.meta, body[off..off + a.length].to_vec()));
        off += a.length;
    }
    if off != body.len() {
        return Err(bad());
    }
    Ok((header.graph_json, assets))
}

/// 書き出しファイル名の検証：パス区切り・予約文字なし、拡張子が形式と一致
pub fn sanitize_export_name(kind: &str, name: &str) -> Result<String> {
    let ext = match kind {
        "html" => ".html",
        "demo-zip" => ".tappivra-demo.zip",
        "project-zip" => ".tappivra-project.zip",
        _ => return Err(StoreError::Invalid("出力形式が不正です".into())),
    };
    let bad = name.is_empty()
        || name.len() > 120
        || name.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0') || c.is_control())
        || name.starts_with('.')
        || !name.ends_with(ext);
    if bad {
        return Err(StoreError::Invalid("ファイル名が不正です".into()));
    }
    Ok(name.to_string())
}

/// tmpへ書いてからrenameする（完成版だけを見せる）
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let dir = path.parent().ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "保存先が不正です"))?;
    let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("export");
    let tmp = dir.join(format!(".{fname}.{}.tmp", std::process::id()));
    let res = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}
