pub fn first(p: *const u8) -> u8 {
    // SAFETY: the caller guarantees p is valid for reads of one byte
    let x = unsafe { *p };
    x
}
