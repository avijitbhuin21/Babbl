//! Global input hook module for handling mouse button shortcuts
//!
//! This module uses the `rdev` crate to listen for global keyboard and mouse events,
//! enabling support for mouse button shortcuts that the standard Tauri global-shortcut
//! plugin cannot handle.

use log::{debug, error, info, warn};
use once_cell::sync::Lazy;
use rdev::{Button, Event, EventType, Key};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use tauri::AppHandle;

use crate::actions::ACTION_MAP;
use crate::settings;
use crate::ManagedToggleState;

/// Represents an input element - either a keyboard key or mouse button
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum InputElement {
    Key(String),        // Normalized key name (e.g., "ctrl", "shift", "a")
    MouseButton(u8),    // Mouse button number (1-5+)
}

impl InputElement {
    /// Parse an input element from a string representation
    pub fn from_str(s: &str) -> Option<Self> {
        let lower = s.trim().to_lowercase();
        
        // Check for mouse button patterns
        if lower.starts_with("mouse") {
            let button_part = lower.trim_start_matches("mouse");
            
            // Handle named mouse buttons
            match button_part {
                "left" | "1" => return Some(InputElement::MouseButton(1)),
                "right" | "2" => return Some(InputElement::MouseButton(2)),
                "middle" | "3" => return Some(InputElement::MouseButton(3)),
                "back" | "4" => return Some(InputElement::MouseButton(4)),
                "forward" | "5" => return Some(InputElement::MouseButton(5)),
                _ => {
                    // Try parsing as a number
                    if let Ok(num) = button_part.parse::<u8>() {
                        return Some(InputElement::MouseButton(num));
                    }
                }
            }
            return None;
        }
        
        // It's a keyboard key
        Some(InputElement::Key(lower))
    }
    
    /// Convert to string representation
    pub fn to_string(&self) -> String {
        match self {
            InputElement::Key(k) => k.clone(),
            InputElement::MouseButton(b) => format!("mouse{}", b),
        }
    }
}

/// A combined shortcut that can contain both keyboard keys and mouse buttons
#[derive(Debug, Clone)]
pub struct CombinedShortcut {
    pub id: String,
    pub elements: HashSet<InputElement>,
    pub requires_mouse: bool,
}

impl CombinedShortcut {
    /// Parse a shortcut binding string into a CombinedShortcut
    pub fn from_binding_string(id: &str, binding: &str) -> Option<Self> {
        let parts: Vec<&str> = binding.split('+').collect();
        let mut elements = HashSet::new();
        let mut requires_mouse = false;
        
        for part in parts {
            if let Some(element) = InputElement::from_str(part) {
                if matches!(element, InputElement::MouseButton(_)) {
                    requires_mouse = true;
                }
                elements.insert(element);
            } else {
                warn!("Failed to parse input element: {}", part);
                return None;
            }
        }
        
        if elements.is_empty() {
            return None;
        }
        
        Some(CombinedShortcut {
            id: id.to_string(),
            elements,
            requires_mouse,
        })
    }
    
    /// Check if all elements of this shortcut are currently pressed
    pub fn is_matched(&self, pressed_elements: &HashSet<InputElement>) -> bool {
        self.elements.iter().all(|e| pressed_elements.contains(e))
    }
}

/// State for tracking currently pressed inputs
struct InputState {
    pressed_keys: HashSet<InputElement>,
    registered_shortcuts: HashMap<String, CombinedShortcut>,
    suspended_shortcuts: HashSet<String>,
    active_shortcuts: HashSet<String>,  // Shortcuts that have been triggered and not yet released
}

impl InputState {
    fn new() -> Self {
        InputState {
            pressed_keys: HashSet::new(),
            registered_shortcuts: HashMap::new(),
            suspended_shortcuts: HashSet::new(),
            active_shortcuts: HashSet::new(),
        }
    }
}

/// Global input hook manager
pub struct InputHookManager {
    state: Arc<RwLock<InputState>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    listener_running: Arc<Mutex<bool>>,
}

/// Global singleton instance
static INPUT_HOOK_MANAGER: Lazy<InputHookManager> = Lazy::new(|| {
    InputHookManager {
        state: Arc::new(RwLock::new(InputState::new())),
        app_handle: Arc::new(Mutex::new(None)),
        listener_running: Arc::new(Mutex::new(false)),
    }
});

impl InputHookManager {
    /// Get the global instance
    pub fn instance() -> &'static InputHookManager {
        &INPUT_HOOK_MANAGER
    }
    
    /// Initialize the input hook manager with an app handle
    pub fn init(&self, app: AppHandle) {
        let mut handle = self.app_handle.lock().unwrap();
        *handle = Some(app);
        
        // Start the listener if not already running
        self.start_listener();
    }
    
    /// Start the global input listener
    fn start_listener(&self) {
        let mut running = self.listener_running.lock().unwrap();
        if *running {
            debug!("Input listener already running");
            return;
        }
        *running = true;
        drop(running);
        
        let state = Arc::clone(&self.state);
        let app_handle = Arc::clone(&self.app_handle);
        let listener_running = Arc::clone(&self.listener_running);
        
        thread::spawn(move || {
            info!("Starting global input listener");
            
            let callback = move |event: Event| {
                Self::handle_event(&state, &app_handle, event);
            };
            
            if let Err(error) = rdev::listen(callback) {
                error!("Error in global input listener: {:?}", error);
                let mut running = listener_running.lock().unwrap();
                *running = false;
            }
        });
    }
    
    /// Handle an input event from rdev
    fn handle_event(
        state: &Arc<RwLock<InputState>>,
        app_handle: &Arc<Mutex<Option<AppHandle>>>,
        event: Event,
    ) {
        let element = match event.event_type {
            EventType::KeyPress(key) => {
                let normalized = Self::normalize_key(key);
                debug!("rdev KeyPress: {:?} -> normalized: {}", key, normalized);
                Some((InputElement::Key(normalized), true))
            }
            EventType::KeyRelease(key) => {
                let normalized = Self::normalize_key(key);
                debug!("rdev KeyRelease: {:?} -> normalized: {}", key, normalized);
                Some((InputElement::Key(normalized), false))
            }
            EventType::ButtonPress(button) => {
                if let Some(num) = Self::button_to_number(button) {
                    debug!("rdev ButtonPress: {:?} -> button number: {}", button, num);
                    Some((InputElement::MouseButton(num), true))
                } else {
                    debug!("rdev ButtonPress: {:?} -> unmapped", button);
                    None
                }
            }
            EventType::ButtonRelease(button) => {
                if let Some(num) = Self::button_to_number(button) {
                    debug!("rdev ButtonRelease: {:?} -> button number: {}", button, num);
                    Some((InputElement::MouseButton(num), false))
                } else {
                    None
                }
            }
            _ => None,
        };
        
        if let Some((input_element, is_press)) = element {
            let mut state_guard = state.write().unwrap();
            
            if is_press {
                state_guard.pressed_keys.insert(input_element.clone());
                
                // Log current pressed state
                debug!("Currently pressed: {:?}", state_guard.pressed_keys);
                
                // Check for shortcut matches
                let pressed = state_guard.pressed_keys.clone();
                
                // Find shortcuts that are matched but not yet active
                let shortcuts_to_trigger: Vec<String> = state_guard
                    .registered_shortcuts
                    .values()
                    .filter(|s| !state_guard.suspended_shortcuts.contains(&s.id))
                    .filter(|s| s.requires_mouse) // Only handle mouse-containing shortcuts
                    .filter(|s| s.is_matched(&pressed)) // Must be matched
                    .filter(|s| !state_guard.active_shortcuts.contains(&s.id)) // Not already active
                    .map(|s| s.id.clone())
                    .collect();
                
                // Mark these shortcuts as active
                for id in &shortcuts_to_trigger {
                    state_guard.active_shortcuts.insert(id.clone());
                }
                
                // Log for debugging
                if !shortcuts_to_trigger.is_empty() {
                    debug!("Shortcuts to trigger (newly matched): {:?}", shortcuts_to_trigger);
                }
                
                drop(state_guard);
                
                // Trigger shortcuts that just became matched
                for shortcut_id in shortcuts_to_trigger {
                    info!("Shortcut matched! Triggering: {}", shortcut_id);
                    Self::trigger_shortcut(app_handle, &shortcut_id, true);
                }
            } else {
                // Key/button released - check if any active shortcuts should be released
                let pressed_before = state_guard.pressed_keys.clone();
                
                // Remove from pressed keys
                state_guard.pressed_keys.remove(&input_element);
                let pressed_after = state_guard.pressed_keys.clone();
                
                debug!("After release, pressed: {:?}", pressed_after);
                
                // Find shortcuts that were active but are no longer matched
                let shortcuts_to_release: Vec<String> = state_guard
                    .active_shortcuts
                    .iter()
                    .filter(|id| {
                        if let Some(shortcut) = state_guard.registered_shortcuts.get(*id) {
                            // Was matched before, not matched now
                            shortcut.is_matched(&pressed_before) && !shortcut.is_matched(&pressed_after)
                        } else {
                            false
                        }
                    })
                    .cloned()
                    .collect();
                
                // Remove from active shortcuts
                for id in &shortcuts_to_release {
                    state_guard.active_shortcuts.remove(id);
                }
                
                drop(state_guard);
                
                // Trigger release for shortcuts that are no longer matched
                for shortcut_id in shortcuts_to_release {
                    debug!("Shortcut release triggered: {}", shortcut_id);
                    Self::trigger_shortcut(app_handle, &shortcut_id, false);
                }
            }
        }
    }

    
    /// Convert rdev Button to a number
    fn button_to_number(button: Button) -> Option<u8> {
        match button {
            Button::Left => Some(1),
            Button::Right => Some(2),
            Button::Middle => Some(3),
            Button::Unknown(code) => {
                // On Windows, XButton1 (back) is often 4, XButton2 (forward) is 5
                // The actual code varies by platform
                #[cfg(target_os = "windows")]
                {
                    // Windows sends XBUTTON1=4, XBUTTON2=5 for the extra buttons
                    if code == 4 || code == 1 {
                        return Some(4); // Back/XButton1
                    } else if code == 5 || code == 2 {
                        return Some(5); // Forward/XButton2
                    }
                }
                
                #[cfg(target_os = "macos")]
                {
                    // macOS button mapping
                    if code == 3 {
                        return Some(4);
                    } else if code == 4 {
                        return Some(5);
                    }
                }
                
                #[cfg(target_os = "linux")]
                {
                    // Linux X11 button mapping (buttons 8 and 9 are often back/forward)
                    if code == 8 {
                        return Some(4);
                    } else if code == 9 {
                        return Some(5);
                    }
                }
                
                // Generic fallback - treat unknown codes as button number
                Some(code as u8)
            }
        }
    }
    
    /// Normalize an rdev Key to a lowercase string
    fn normalize_key(key: Key) -> String {
        match key {
            Key::Alt | Key::AltGr => "alt".to_string(),
            Key::Backspace => "backspace".to_string(),
            Key::CapsLock => "capslock".to_string(),
            Key::ControlLeft | Key::ControlRight => "ctrl".to_string(),
            Key::Delete => "delete".to_string(),
            Key::DownArrow => "down".to_string(),
            Key::End => "end".to_string(),
            Key::Escape => "esc".to_string(),
            Key::F1 => "f1".to_string(),
            Key::F2 => "f2".to_string(),
            Key::F3 => "f3".to_string(),
            Key::F4 => "f4".to_string(),
            Key::F5 => "f5".to_string(),
            Key::F6 => "f6".to_string(),
            Key::F7 => "f7".to_string(),
            Key::F8 => "f8".to_string(),
            Key::F9 => "f9".to_string(),
            Key::F10 => "f10".to_string(),
            Key::F11 => "f11".to_string(),
            Key::F12 => "f12".to_string(),
            Key::Home => "home".to_string(),
            Key::LeftArrow => "left".to_string(),
            Key::MetaLeft | Key::MetaRight => {
                #[cfg(target_os = "macos")]
                { "command".to_string() }
                #[cfg(target_os = "windows")]
                { "win".to_string() }
                #[cfg(target_os = "linux")]
                { "super".to_string() }
                #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
                { "meta".to_string() }
            }
            Key::PageDown => "pagedown".to_string(),
            Key::PageUp => "pageup".to_string(),
            Key::Return => "enter".to_string(),
            Key::RightArrow => "right".to_string(),
            Key::ShiftLeft | Key::ShiftRight => "shift".to_string(),
            Key::Space => "space".to_string(),
            Key::Tab => "tab".to_string(),
            Key::UpArrow => "up".to_string(),
            Key::PrintScreen => "printscreen".to_string(),
            Key::ScrollLock => "scrolllock".to_string(),
            Key::Pause => "pause".to_string(),
            Key::NumLock => "numlock".to_string(),
            Key::Insert => "insert".to_string(),
            Key::KeyA => "a".to_string(),
            Key::KeyB => "b".to_string(),
            Key::KeyC => "c".to_string(),
            Key::KeyD => "d".to_string(),
            Key::KeyE => "e".to_string(),
            Key::KeyF => "f".to_string(),
            Key::KeyG => "g".to_string(),
            Key::KeyH => "h".to_string(),
            Key::KeyI => "i".to_string(),
            Key::KeyJ => "j".to_string(),
            Key::KeyK => "k".to_string(),
            Key::KeyL => "l".to_string(),
            Key::KeyM => "m".to_string(),
            Key::KeyN => "n".to_string(),
            Key::KeyO => "o".to_string(),
            Key::KeyP => "p".to_string(),
            Key::KeyQ => "q".to_string(),
            Key::KeyR => "r".to_string(),
            Key::KeyS => "s".to_string(),
            Key::KeyT => "t".to_string(),
            Key::KeyU => "u".to_string(),
            Key::KeyV => "v".to_string(),
            Key::KeyW => "w".to_string(),
            Key::KeyX => "x".to_string(),
            Key::KeyY => "y".to_string(),
            Key::KeyZ => "z".to_string(),
            Key::Num0 => "0".to_string(),
            Key::Num1 => "1".to_string(),
            Key::Num2 => "2".to_string(),
            Key::Num3 => "3".to_string(),
            Key::Num4 => "4".to_string(),
            Key::Num5 => "5".to_string(),
            Key::Num6 => "6".to_string(),
            Key::Num7 => "7".to_string(),
            Key::Num8 => "8".to_string(),
            Key::Num9 => "9".to_string(),
            Key::Minus => "-".to_string(),
            Key::Equal => "=".to_string(),
            Key::LeftBracket => "[".to_string(),
            Key::RightBracket => "]".to_string(),
            Key::SemiColon => ";".to_string(),
            Key::Quote => "'".to_string(),
            Key::BackSlash => "\\".to_string(),
            Key::Comma => ",".to_string(),
            Key::Dot => ".".to_string(),
            Key::Slash => "/".to_string(),
            Key::BackQuote => "`".to_string(),
            Key::Unknown(code) => format!("key{}", code),
            _ => "unknown".to_string(),
        }
    }
    
    /// Trigger a shortcut action
    fn trigger_shortcut(
        app_handle: &Arc<Mutex<Option<AppHandle>>>,
        binding_id: &str,
        is_press: bool,
    ) {
        let app_guard = app_handle.lock().unwrap();
        if let Some(app) = app_guard.as_ref() {
            let settings = settings::get_settings(app);
            
            if let Some(action) = ACTION_MAP.get(binding_id) {
                if binding_id == "cancel" {
                    // Cancel action only triggers on press
                    if is_press {
                        use crate::managers::audio::AudioRecordingManager;
                        use tauri::Manager;
                        let audio_manager = app.state::<Arc<AudioRecordingManager>>();
                        if audio_manager.is_recording() {
                            action.start(app, binding_id, "mouse_shortcut");
                        }
                    }
                } else if settings.push_to_talk {
                    // Push-to-talk mode: press = start, release = stop
                    if is_press {
                        debug!("Mouse shortcut triggered (press): {}", binding_id);
                        action.start(app, binding_id, "mouse_shortcut");
                    } else {
                        debug!("Mouse shortcut triggered (release): {}", binding_id);
                        action.stop(app, binding_id, "mouse_shortcut");
                    }
                } else {
                    // Toggle mode: only trigger on press
                    if is_press {
                        use tauri::Manager;
                        let toggle_state_manager = app.state::<ManagedToggleState>();
                        
                        let mut states = toggle_state_manager.lock().expect("Failed to lock toggle state manager");
                        let is_currently_active = states.active_toggles
                            .entry(binding_id.to_string())
                            .or_insert(false);
                        
                        if *is_currently_active {
                            action.stop(app, binding_id, "mouse_shortcut");
                            *is_currently_active = false;
                        } else {
                            action.start(app, binding_id, "mouse_shortcut");
                            *is_currently_active = true;
                        }
                    }
                }
            } else {
                warn!("No action found for binding: {}", binding_id);
            }
        }
    }
    
    /// Register a mouse-containing shortcut
    pub fn register_shortcut(&self, id: &str, binding: &str) -> Result<(), String> {
        let shortcut = CombinedShortcut::from_binding_string(id, binding)
            .ok_or_else(|| format!("Failed to parse shortcut: {}", binding))?;
        
        if !shortcut.requires_mouse {
            return Err("This shortcut doesn't contain mouse buttons - use global-shortcut instead".to_string());
        }
        
        debug!("Registering mouse shortcut '{}' with binding '{}', parsed elements: {:?}", 
               id, binding, shortcut.elements);
        
        let mut state = self.state.write().unwrap();
        state.registered_shortcuts.insert(id.to_string(), shortcut);
        info!("Registered mouse shortcut: {} = {}", id, binding);
        
        Ok(())
    }

    
    /// Unregister a shortcut
    pub fn unregister_shortcut(&self, id: &str) -> Result<(), String> {
        let mut state = self.state.write().unwrap();
        state.registered_shortcuts.remove(id);
        state.suspended_shortcuts.remove(id);
        debug!("Unregistered mouse shortcut: {}", id);
        
        Ok(())
    }
    
    /// Temporarily suspend a shortcut (while editing)
    pub fn suspend_shortcut(&self, id: &str) {
        let mut state = self.state.write().unwrap();
        state.suspended_shortcuts.insert(id.to_string());
        debug!("Suspended mouse shortcut: {}", id);
    }
    
    /// Resume a suspended shortcut
    pub fn resume_shortcut(&self, id: &str) {
        let mut state = self.state.write().unwrap();
        state.suspended_shortcuts.remove(id);
        debug!("Resumed mouse shortcut: {}", id);
    }
    
    /// Check if a shortcut is registered
    pub fn is_registered(&self, id: &str) -> bool {
        let state = self.state.read().unwrap();
        state.registered_shortcuts.contains_key(id)
    }
}

/// Check if a binding string contains mouse buttons
pub fn contains_mouse_button(binding: &str) -> bool {
    let mouse_patterns = [
        "mouse1", "mouse2", "mouse3", "mouse4", "mouse5",
        "mouseleft", "mouseright", "mousemiddle",
        "mouseforward", "mouseback",
    ];
    
    binding.split('+')
        .any(|part| {
            let lower = part.trim().to_lowercase();
            mouse_patterns.contains(&lower.as_str()) || 
            (lower.starts_with("mouse") && lower.trim_start_matches("mouse").parse::<u8>().is_ok())
        })
}

/// Initialize the input hook system
pub fn init_input_hooks(app: &AppHandle) {
    InputHookManager::instance().init(app.clone());
}

/// Register a mouse shortcut (called from shortcut.rs)
pub fn register_mouse_shortcut(id: &str, binding: &str) -> Result<(), String> {
    InputHookManager::instance().register_shortcut(id, binding)
}

/// Unregister a mouse shortcut (called from shortcut.rs)
pub fn unregister_mouse_shortcut(id: &str) -> Result<(), String> {
    InputHookManager::instance().unregister_shortcut(id)
}

/// Suspend a mouse shortcut (called from shortcut.rs)
pub fn suspend_mouse_shortcut(id: &str) {
    InputHookManager::instance().suspend_shortcut(id)
}

/// Resume a mouse shortcut (called from shortcut.rs)
pub fn resume_mouse_shortcut(id: &str) {
    InputHookManager::instance().resume_shortcut(id)
}

/// Check if a mouse shortcut is registered
pub fn is_mouse_shortcut_registered(id: &str) -> bool {
    InputHookManager::instance().is_registered(id)
}
