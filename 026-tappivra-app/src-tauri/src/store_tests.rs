use crate::store::*;

const P1: &str = "11111111-1111-4111-8111-111111111111";
const P2: &str = "22222222-2222-4222-8222-222222222222";
const A1: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const A2: &str = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

fn png() -> Vec<u8> {
    let mut v = vec![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    v.extend_from_slice(b"fake-png-body-for-store-tests");
    v
}

fn meta(id: &str, pid: &str, data: &[u8]) -> AssetMeta {
    AssetMeta {
        id: id.into(),
        project_id: pid.into(),
        mime: "image/png".into(),
        width: 10,
        height: 10,
        byte_length: data.len() as i64,
        sha256: sha256_hex(data),
        created_at: "2026-10-04T00:00:00Z".into(),
    }
}

fn graph(pid: &str, assets: &[&str]) -> String {
    let a: serde_json::Map<String, serde_json::Value> = assets.iter().map(|id| (id.to_string(), serde_json::json!({}))).collect();
    serde_json::json!({ "project": { "id": pid, "name": "テスト", "stepOrder": [] }, "steps": {}, "assets": a }).to_string()
}

#[test]
fn uuid_validation() {
    assert!(is_uuid(P1));
    assert!(!is_uuid("../etc/passwd"));
    assert!(!is_uuid("11111111-1111-4111-8111-11111111111G"));
    assert!(!is_uuid("1' OR '1'='1"));
}

#[test]
fn create_is_atomic_and_rejects_bad_asset() {
    let mut s = Store::open_in_memory().unwrap();
    let d = png();
    let mut bad = meta(A1, P1, &d);
    bad.sha256 = "0".repeat(64);
    assert!(s.create_project(P1, &graph(P1, &[A1]), &[(bad, d.clone())]).is_err());
    // 失敗時はプロジェクトも残らない
    assert_eq!(s.list_projects().unwrap().len(), 0);
    assert_eq!(s.create_project(P1, &graph(P1, &[A1]), &[(meta(A1, P1, &d), d.clone())]).unwrap(), 1);
    assert_eq!(s.list_projects().unwrap().len(), 1);
    assert_eq!(s.get_asset(P1, A1).unwrap(), d);
}

#[test]
fn revision_conflict_is_rejected() {
    let mut s = Store::open_in_memory().unwrap();
    s.create_project(P1, &graph(P1, &[]), &[]).unwrap();
    assert_eq!(s.save_project(P1, 1, &graph(P1, &[])).unwrap(), 2);
    // 古いrevisionでの上書きは拒否
    assert!(matches!(s.save_project(P1, 1, &graph(P1, &[])), Err(StoreError::Conflict)));
    assert_eq!(s.load_project(P1).unwrap().revision, 2);
}

#[test]
fn ownership_is_enforced() {
    let mut s = Store::open_in_memory().unwrap();
    let d = png();
    s.create_project(P1, &graph(P1, &[A1]), &[(meta(A1, P1, &d), d.clone())]).unwrap();
    s.create_project(P2, &graph(P2, &[]), &[]).unwrap();
    // 別プロジェクトの画像は取得できない
    assert!(s.get_asset(P2, A1).is_err());
    // 別プロジェクトの画像を参照するグラフは保存できない
    assert!(s.save_project(P2, 1, &graph(P2, &[A1])).is_err());
    // 既存の画像IDを別プロジェクトとして登録できない
    assert!(s.put_asset(&meta(A1, P2, &d), &d).is_err());
    // project.idとコマンドのIDが違うグラフは拒否
    assert!(s.save_project(P1, 1, &graph(P2, &[])).is_err());
}

#[test]
fn asset_validation() {
    let mut s = Store::open_in_memory().unwrap();
    s.create_project(P1, &graph(P1, &[]), &[]).unwrap();
    let html = b"<html><script>alert(1)</script></html>".to_vec();
    let mut m = meta(A1, P1, &html);
    assert!(s.put_asset(&m, &html).is_err(), "PNG名のHTMLは拒否");
    let d = png();
    m = meta(A1, P1, &d);
    m.mime = "image/svg+xml".into();
    assert!(s.put_asset(&m, &d).is_err());
    let big = vec![0u8; MAX_ASSET_BYTES + 1];
    assert!(s.put_asset(&meta(A2, P1, &big), &big).is_err());
}

#[test]
fn gc_keeps_referenced_assets() {
    let mut s = Store::open_in_memory().unwrap();
    let d = png();
    s.create_project(P1, &graph(P1, &[A1]), &[(meta(A1, P1, &d), d.clone())]).unwrap();
    s.put_asset(&meta(A2, P1, &d), &d).unwrap();
    assert_eq!(s.gc_assets(P1, &[]).unwrap(), 1);
    assert!(s.get_asset(P1, A1).is_ok());
    assert!(s.get_asset(P1, A2).is_err());
}

#[test]
fn delete_project_cascades_and_delete_all_requires_phrase() {
    let mut s = Store::open_in_memory().unwrap();
    let d = png();
    s.create_project(P1, &graph(P1, &[A1]), &[(meta(A1, P1, &d), d.clone())]).unwrap();
    s.delete_project(P1).unwrap();
    assert!(s.get_asset(P1, A1).is_err());
    s.create_project(P2, &graph(P2, &[]), &[]).unwrap();
    assert!(s.delete_all("delete").is_err());
    assert_eq!(s.usage().unwrap().projects, 1);
    s.delete_all(DELETE_ALL_PHRASE).unwrap();
    assert_eq!(s.usage().unwrap().projects, 0);
}

#[test]
fn export_record_rejects_paths() {
    let mut s = Store::open_in_memory().unwrap();
    s.create_project(P1, &graph(P1, &[]), &[]).unwrap();
    let rec = |name: &str| serde_json::json!({"id": A1, "projectId": P1, "projectRevision": 1, "fileName": name}).to_string();
    assert!(s.record_export(P1, &rec("C:\\Users\\me\\demo.html")).is_err());
    assert!(s.record_export(P1, &rec("demo.html")).is_ok());
}

#[test]
fn export_names_are_sanitized() {
    assert!(sanitize_export_name("html", "tappivra-demo_x_r3.html").is_ok());
    assert!(sanitize_export_name("html", "../evil.html").is_err());
    assert!(sanitize_export_name("html", "C:evil.html").is_err());
    assert!(sanitize_export_name("demo-zip", "x.tappivra-project.zip").is_err());
    assert!(sanitize_export_name("exe", "x.exe").is_err());
}

#[test]
fn create_body_parsing() {
    let d = png();
    let header = serde_json::json!({"graphJson": graph(P1, &[A1]), "assets": [{"meta": meta(A1, P1, &d), "length": d.len()}]}).to_string();
    let mut body = (header.len() as u32).to_le_bytes().to_vec();
    body.extend_from_slice(header.as_bytes());
    body.extend_from_slice(&d);
    let (g, assets) = parse_create_body(&body).unwrap();
    assert_eq!(assets.len(), 1);
    assert!(g.contains(P1));
    body.push(0);
    assert!(parse_create_body(&body).is_err(), "余分なbytesは拒否");
}

#[test]
fn file_db_migration_and_future_version() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("t.sqlite3");
    {
        let mut s = Store::open(&p).unwrap();
        s.create_project(P1, &graph(P1, &[]), &[]).unwrap();
    }
    // 再オープンでデータ保持
    {
        let s = Store::open(&p).unwrap();
        assert_eq!(s.list_projects().unwrap().len(), 1);
    }
    // 未来のスキーマは拒否し、ファイルを変更しない
    {
        let c = rusqlite::Connection::open(&p).unwrap();
        c.pragma_update(None, "user_version", 999).unwrap();
    }
    assert!(Store::open(&p).is_err());
}

#[test]
fn atomic_write_replaces_and_leaves_no_tmp() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("out.html");
    write_atomic(&p, b"v1").unwrap();
    write_atomic(&p, b"v2").unwrap();
    assert_eq!(std::fs::read(&p).unwrap(), b"v2");
    let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names.len(), 1);
    // 書込先ディレクトリが存在しない場合は失敗し、完成版を作らない
    assert!(write_atomic(&dir.path().join("missing/out.html"), b"x").is_err());
}

/// T35 負荷：25プロジェクト・合計約500MiBの画像を登録し、一覧・取得・削除の所要時間を計測する。
/// 重いため通常は除外：cargo test --manifest-path src-tauri/Cargo.toml -- --ignored --nocapture
#[test]
#[ignore]
fn load_25_projects_500mib() {
    use std::time::Instant;
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("load.sqlite3");
    let mut s = Store::open(&p).unwrap();
    let t0 = Instant::now();
    let mut base = png();
    base.resize(4 * 1024 * 1024, 0x5a); // 1枚4MiB相当
    for i in 0..25u32 {
        let pid = format!("{:08x}-0000-4000-8000-000000000000", i + 1);
        let mut assets = Vec::new();
        for j in 0..5u32 {
            let mut d = base.clone();
            d[20..24].copy_from_slice(&(i * 100 + j).to_le_bytes());
            let aid = format!("{:08x}-{:04x}-4000-8000-000000000000", i + 1, j + 1);
            assets.push((meta(&aid, &pid, &d), d));
        }
        let ids: Vec<&str> = assets.iter().map(|(m, _)| m.id.as_str()).collect();
        s.create_project(&pid, &graph(&pid, &ids), &assets).unwrap();
    }
    let t_create = t0.elapsed();
    let t1 = Instant::now();
    assert_eq!(s.list_projects().unwrap().len(), 25);
    let t_list = t1.elapsed();
    let u = s.usage().unwrap();
    let t2 = Instant::now();
    let pid = format!("{:08x}-0000-4000-8000-000000000000", 7);
    let aid = format!("{:08x}-{:04x}-4000-8000-000000000000", 7, 3);
    assert_eq!(s.get_asset(&pid, &aid).unwrap().len(), 4 * 1024 * 1024);
    let t_get = t2.elapsed();
    let file_mib = std::fs::metadata(&p).unwrap().len() as f64 / 1048576.0;
    let t3 = Instant::now();
    s.delete_all(DELETE_ALL_PHRASE).unwrap();
    let t_del = t3.elapsed();
    println!(
        "LOAD: 25 projects / {:.0} MiB stored (db file {:.0} MiB). create {:?}, list {:?}, get 4MiB {:?}, delete_all+vacuum {:?}",
        u.bytes as f64 / 1048576.0, file_mib, t_create, t_list, t_get, t_del
    );
}
