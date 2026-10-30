// Copyright (c) 2026 perpetualtechnologies. All rights reserved.
// Proprietary and confidential. Unauthorised copying, modification,
// or distribution is strictly prohibited.

// Self-test fixture for the sidecar-tests check: a test that fails on purpose, so Meerkat proves it notices a failing cargo test.
#[test]
fn fails_on_purpose() {
    assert_eq!(1, 2);
}
