use serde::Serialize;

#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
pub enum AppError {
    #[error("Config error: {0}")]
    Config(String),

    #[error("Shortcut error: {0}")]
    Shortcut(String),

    #[error("Clipboard error: {0}")]
    Clipboard(String),

    #[error("Window error: {0}")]
    Window(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_messages() {
        let err = AppError::Config("bad value".into());
        assert_eq!(err.to_string(), "Config error: bad value");

        let err = AppError::Shortcut("invalid key".into());
        assert_eq!(err.to_string(), "Shortcut error: invalid key");

        let err = AppError::Clipboard("access denied".into());
        assert_eq!(err.to_string(), "Clipboard error: access denied");

        let err = AppError::Window("not found".into());
        assert_eq!(err.to_string(), "Window error: not found");

        let err = AppError::Other("something".into());
        assert_eq!(err.to_string(), "something");
    }

    #[test]
    fn error_serializes_as_string() {
        let err = AppError::Config("test".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"Config error: test\"");
    }

    #[test]
    fn io_error_converts() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let err: AppError = io_err.into();
        assert!(err.to_string().contains("file not found"));
    }
}
