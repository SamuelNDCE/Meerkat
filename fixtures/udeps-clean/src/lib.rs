pub fn show(x: u32) -> String {
    let mut buf = itoa::Buffer::new();
    buf.format(x).to_string()
}
