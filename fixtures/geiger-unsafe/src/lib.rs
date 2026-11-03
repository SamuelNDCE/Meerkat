pub fn first(values: &[u8]) -> u8 {
    let ptr = values.as_ptr();
    unsafe { *ptr }
}
