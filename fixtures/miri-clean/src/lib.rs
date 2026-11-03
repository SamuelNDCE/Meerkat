pub fn read_in_bounds() -> u8 {
    let v = vec![1u8, 2, 3];
    let p = v.as_ptr();
    unsafe { *p.add(2) }
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads() {
        assert_eq!(super::read_in_bounds(), 3);
    }
}
