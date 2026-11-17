// Where the shared agent (chatbot-revit/AI_Manage) and the project folder of the CDE live.
// Studio no copia el agente: lo lanza desde su carpeta, igual que la app de Revit.

use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

/// Un proceso por lanzar: programa, argumentos, carpeta de trabajo y variables de entorno.
#[derive(Clone, Debug)]
pub struct ProcSpec {
    pub program: PathBuf,
    pub args: Vec<OsString>,
    pub cwd: PathBuf,
    pub envs: Vec<(String, OsString)>,
}

impl ProcSpec {
    /// Fails before launching with a readable reason: «<path> not found», to be shown as is.
    pub fn check(&self) -> Result<(), String> {
        if !self.program.is_file() {
            return Err(format!("{} not found", self.program.display()));
        }
        if let Some(script) = self.args.get(1).map(Path::new)
            && !script.is_file()
        {
            return Err(format!("{} not found", script.display()));
        }
        if !self.cwd.is_dir() {
            return Err(format!("{} not found", self.cwd.display()));
        }
        Ok(())
    }

    pub fn std_command(&self) -> std::process::Command {
        let mut cmd = std::process::Command::new(&self.program);
        cmd.args(&self.args).current_dir(&self.cwd);
        for (k, v) in &self.envs {
            cmd.env(k, v);
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd
    }
}

/// The IFCx root: the first ancestor of the executable (up to 8 levels) that contains `studio/src-tauri`.
pub fn ifcx_root_from(exe: &Path) -> Option<PathBuf> {
    exe.ancestors()
        .take(8)
        .find(|d| d.join("studio").join("src-tauri").is_dir())
        .map(Path::to_path_buf)
}

fn env_or(env: Option<OsString>, default: PathBuf) -> PathBuf {
    match env {
        Some(v) if !v.is_empty() => PathBuf::from(v),
        _ => default,
    }
}

/// Carpeta de `chatbot-revit`: `IFCX_CHATBOT_DIR` o la hermana de IFCx.
pub fn chatbot_dir(env: Option<OsString>, ifcx_root: &Path) -> PathBuf {
    env_or(env, ifcx_root.join("..").join("chatbot-revit"))
}

/// Nombre de la carpeta de proyecto (el CDE de ejemplo) dentro de IFCx.
pub const PROJECT_FOLDER: &str = "Snowdon Towers Example";

/// Carpeta de trabajo del agente: `IFCX_PROJECT_DIR` o `Snowdon Towers Example/` de IFCx.
pub fn project_dir(env: Option<OsString>, ifcx_root: &Path) -> PathBuf {
    env_or(env, ifcx_root.join(PROJECT_FOLDER))
}

/// The agent's stdio bridge. `IFCX_STUDIO_HOST=1` declares the host.
pub fn bridge_spec(chatbot: &Path) -> ProcSpec {
    let ai = chatbot.join("AI_Manage");
    ProcSpec {
        program: ai.join(".venv").join("Scripts").join("python.exe"),
        args: vec![
            OsString::from("-u"),
            ai.join("src").join("bridge").join("stdio_server.py").into_os_string(),
        ],
        cwd: ai.clone(),
        envs: vec![
            ("PYTHONPATH".into(), ai.into_os_string()),
            ("PYTHONUNBUFFERED".into(), OsStr::new("1").to_os_string()),
            ("PYTHONIOENCODING".into(), OsStr::new("utf-8").to_os_string()),
            ("IFCX_STUDIO_HOST".into(), OsStr::new("1").to_os_string()),
        ],
    }
}

/// Reads the executable and the variables and returns the bridge to launch and the project folder.
pub fn detect() -> Result<(ProcSpec, PathBuf), String> {
    let exe = std::env::current_exe().map_err(|e| format!("Could not locate the executable: {e}"))?;
    let root = ifcx_root_from(&exe).ok_or("IFCx folder not found next to the executable")?;
    let chatbot = chatbot_dir(std::env::var_os("IFCX_CHATBOT_DIR"), &root);
    let project = project_dir(std::env::var_os("IFCX_PROJECT_DIR"), &root);
    Ok((bridge_spec(&chatbot), project))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ifcx_asist_{}_{}", std::process::id(), name));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn root_from_exe() {
        let t = tmp("raiz");
        let exe_dir = t.join("IFCx").join("studio").join("src-tauri").join("target").join("debug");
        std::fs::create_dir_all(&exe_dir).unwrap();
        assert_eq!(ifcx_root_from(&exe_dir.join("dream-bim.exe")), Some(t.join("IFCx")));
        let outside = tmp("raiz_fuera");
        assert_eq!(ifcx_root_from(&outside.join("dream-bim.exe")), None);
        std::fs::remove_dir_all(&t).ok();
        std::fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn chatbot_defaults_to_the_sibling_folder() {
        let root = Path::new("C:/x/IFCx");
        assert_eq!(chatbot_dir(None, root), root.join("..").join("chatbot-revit"));
        assert_eq!(chatbot_dir(Some(OsString::from("D:/bot")), root), PathBuf::from("D:/bot"));
        assert_eq!(chatbot_dir(Some(OsString::new()), root), root.join("..").join("chatbot-revit"));
    }

    #[test]
    fn project_defaults_to_the_example_folder() {
        let root = Path::new("C:/x/IFCx");
        assert_eq!(project_dir(None, root), root.join("Snowdon Towers Example"));
        assert_eq!(project_dir(Some(OsString::from("D:/p")), root), PathBuf::from("D:/p"));
        assert_eq!(project_dir(Some(OsString::new()), root), root.join("Snowdon Towers Example"));
    }

    #[test]
    fn bridge_spec_launches_python_with_the_host_flag() {
        let b = Path::new("C:/b");
        let s = bridge_spec(b);
        let ai = b.join("AI_Manage");
        assert_eq!(s.program, ai.join(".venv").join("Scripts").join("python.exe"));
        assert_eq!(
            s.args,
            vec![OsString::from("-u"), ai.join("src").join("bridge").join("stdio_server.py").into_os_string()]
        );
        assert_eq!(s.cwd, ai);
        assert!(s.envs.contains(&("IFCX_STUDIO_HOST".to_string(), OsString::from("1"))));
        assert!(s.envs.contains(&("PYTHONPATH".to_string(), ai.clone().into_os_string())));
    }

    #[test]
    fn check_says_what_is_missing() {
        let t = tmp("check");
        let s = bridge_spec(&t);
        let e = s.check().unwrap_err();
        assert!(e.ends_with("python.exe not found"), "{e}");
        let py = s.program.clone();
        std::fs::create_dir_all(py.parent().unwrap()).unwrap();
        std::fs::write(&py, "").unwrap();
        let e = s.check().unwrap_err();
        assert!(e.ends_with("stdio_server.py not found"), "{e}");
        std::fs::remove_dir_all(&t).ok();
    }
}
