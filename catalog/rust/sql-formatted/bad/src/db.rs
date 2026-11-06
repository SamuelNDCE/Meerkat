pub fn remove(conn: &Conn, id: i64) {
    conn.execute(&format!("DELETE FROM t WHERE id={}", id), []);
}
