#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use log::{error, info};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TenantConfig {
    pub app_url: String,
    #[serde(rename = "name")]
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopConfig {
    pub env: String,
    pub default_tenant: String,
    pub tenants: HashMap<String, TenantConfig>,
    pub keycloak: Option<KeycloakConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeycloakConfig {
    #[serde(rename = "tenantClaim")]
    pub tenant_claim: Option<String>,
}

#[derive(Default)]
pub struct SecureStore(Mutex<HashMap<String, String>>);

fn get_config_path(env: &str) -> PathBuf {
    let base = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    
    base.join("config").join(format!("{}.json", env))
}

fn load_config(env: &str) -> Result<DesktopConfig, String> {
    let config_path = get_config_path(env);
    info!("Loading config from: {:?}", config_path);
    
    let raw = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;
    
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse config: {}", e))
}

#[tauri::command]
fn get_config() -> Result<serde_json::Value, String> {
    let env = std::env::var("DESKTOP_ENV").unwrap_or_else(|_| "dev".to_string());
    let config = load_config(&env)?;
    
    let tenant_id = std::env::var("DESKTOP_TENANT")
        .unwrap_or_else(|_| config.default_tenant.clone());
    
    let tenant = config.tenants.get(&tenant_id)
        .or_else(|| config.tenants.values().next())
        .ok_or("No tenant configuration found")?;
    
    Ok(serde_json::json!({
        "env": config.env,
        "tenantId": tenant_id,
        "appUrl": tenant.app_url,
        "tenantName": tenant.name.as_ref().unwrap_or(&tenant_id)
    }))
}

#[tauri::command]
fn notify(title: String, body: String, app_handle: AppHandle) -> Result<(), String> {
    app_handle.emit("notification", serde_json::json!({ "title": title, "body": body }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_secure_store(key: String, store: State<'_, SecureStore>) -> Option<String> {
    let store = store.0.lock().ok()?;
    store.get(&key).cloned()
}

#[tauri::command]
fn set_secure_store(key: String, value: String, store: State<'_, SecureStore>) -> Result<(), String> {
    let mut store = store.0.lock().map_err(|e| e.to_string())?;
    store.insert(key, value);
    Ok(())
}

#[tauri::command]
fn delete_secure_store(key: String, store: State<'_, SecureStore>) -> Result<(), String> {
    let mut store = store.0.lock().map_err(|e| e.to_string())?;
    store.remove(&key);
    Ok(())
}

#[tauri::command]
fn get_auto_launch(app_handle: AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        if let Ok(settings) = app_handle.autolaunch().is_enabled() {
            return settings;
        }
    }
    false
}

#[tauri::command]
fn set_auto_launch(enabled: bool, app_handle: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let autolaunch = app_handle.autolaunch();
        if enabled {
            autolaunch.enable().map_err(|e| e.to_string())?;
        } else {
            autolaunch.disable().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    
    let menu = Menu::with_items(app, &[&show, &hide, &reload, &quit])?;
    
    let icon_bytes = include_bytes!("../icons/icon.png");
    let icon = Image::from_bytes(icon_bytes)?;
    
    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip("SmartOps Desktop")
        .on_menu_event(move |app, event| {
            match event.id.as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "hide" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.hide();
                    }
                }
                "reload" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.reload();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .init();
    
    info!("Starting SmartOps Desktop");
    
    std::panic::set_hook(Box::new(|panic_info| {
        error!("Application panic: {}", panic_info);
    }));
    
    let config = load_config(&std::env::var("DESKTOP_ENV").unwrap_or_else(|_| "dev".to_string()))
        .expect("Failed to load config");
    
    let tenant_id = std::env::var("DESKTOP_TENANT")
        .unwrap_or_else(|_| config.default_tenant.clone());
    
    let tenant = config.tenants.get(&tenant_id)
        .or_else(|| config.tenants.values().next())
        .expect("No tenant configuration found");
    
    info!("Loading app URL: {}", tenant.app_url);
    
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_shell::init())
        .manage(SecureStore::default())
        .setup(|app| {
            info!("Setting up application");
            
            if let Err(e) = setup_tray(app.handle()) {
                error!("Failed to setup tray: {}", e);
            }
            
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        #[cfg(target_os = "macos")]
                        {
                            api.prevent_close();
                            let _ = window_clone.hide();
                        }
                    }
                });
            }
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            notify,
            get_secure_store,
            set_secure_store,
            delete_secure_store,
            get_auto_launch,
            set_auto_launch,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
