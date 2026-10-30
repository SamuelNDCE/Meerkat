// Fixture: pretends to be a failing proptest run (the parser "panicked" on a malformed file).
console.log('running 1 test\ntest proptests::frontmatter_never_panics ... FAILED\nminimal failing input: raw = "---\n\u{0}"');
process.exit(101);
