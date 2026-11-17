/// Does the path end in one of the allowed extensions (case-insensitive)?
pub fn has_extension(path: &str, allowed: &[&str]) -> bool {
    std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| allowed.iter().any(|a| e.eq_ignore_ascii_case(a)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_ignoring_case() {
        assert!(has_extension("a/b.IFCX", &["ifcx"]));
        assert!(has_extension("a.Csv", &["ifcx", "csv"]));
    }

    #[test]
    fn rejects_other_or_missing_extensions() {
        assert!(!has_extension("a.txt", &["ifcx"]));
        assert!(!has_extension("no_extension", &["ifcx"]));
        assert!(!has_extension("dir.ifcx/file", &["ifcx"]));
    }
}
