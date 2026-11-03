pub fn read_past_end() -> u8 {
    let v = vec![1u8, 2, 3];
    let p = v.as_ptr();
    unsafe { *p.add(5) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads() {
        let _ = super::read_past_end();
    }
}
