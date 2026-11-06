pub fn remove(conn: &Conn, id: i64) {
    conn.execute("DELETE FROM t WHERE id = ?1", [id]);
}
