pub fn first(p: *const u8) -> u8 {
    let x = unsafe { *p };
    x
}
