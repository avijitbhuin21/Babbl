/**
 * Keyboard and mouse utility functions for handling input events
 */

export type OSType = "macos" | "windows" | "linux" | "unknown";

/**
 * Extract a consistent key name from a KeyboardEvent
 * This function provides cross-platform keyboard event handling
 * and returns key names appropriate for the target operating system
 */
export const getKeyName = (
  e: KeyboardEvent,
  osType: OSType = "unknown",
): string => {
  // Handle special cases first
  if (e.code) {
    const code = e.code;

    // Handle function keys (F1-F24)
    if (code.match(/^F\d+$/)) {
      return code.toLowerCase(); // F1, F2, ..., F14, F15, etc.
    }

    // Handle regular letter keys (KeyA -> a)
    if (code.match(/^Key[A-Z]$/)) {
      return code.replace("Key", "").toLowerCase();
    }

    // Handle digit keys (Digit0 -> 0)
    if (code.match(/^Digit\d$/)) {
      return code.replace("Digit", "");
    }

    // Handle numpad digit keys (Numpad0 -> numpad 0)
    if (code.match(/^Numpad\d$/)) {
      return code.replace("Numpad", "numpad ").toLowerCase();
    }

    // Handle modifier keys - OS-specific naming
    const getModifierName = (baseModifier: string): string => {
      switch (baseModifier) {
        case "shift":
          return "shift";
        case "ctrl":
          return osType === "macos" ? "ctrl" : "ctrl";
        case "alt":
          return osType === "macos" ? "option" : "alt";
        case "meta":
          // Windows key on Windows/Linux, Command key on Mac
          if (osType === "macos") return "command";
          return "super";
        default:
          return baseModifier;
      }
    };

    const modifierMap: Record<string, string> = {
      ShiftLeft: getModifierName("shift"),
      ShiftRight: getModifierName("shift"),
      ControlLeft: getModifierName("ctrl"),
      ControlRight: getModifierName("ctrl"),
      AltLeft: getModifierName("alt"),
      AltRight: getModifierName("alt"),
      MetaLeft: getModifierName("meta"),
      MetaRight: getModifierName("meta"),
      OSLeft: getModifierName("meta"),
      OSRight: getModifierName("meta"),
      CapsLock: "caps lock",
      Tab: "tab",
      Enter: "enter",
      Space: "space",
      Backspace: "backspace",
      Delete: "delete",
      Escape: "esc",
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Home: "home",
      End: "end",
      PageUp: "page up",
      PageDown: "page down",
      Insert: "insert",
      PrintScreen: "print screen",
      ScrollLock: "scroll lock",
      Pause: "pause",
      ContextMenu: "menu",
      NumpadMultiply: "numpad *",
      NumpadAdd: "numpad +",
      NumpadSubtract: "numpad -",
      NumpadDecimal: "numpad .",
      NumpadDivide: "numpad /",
      NumLock: "num lock",
    };

    if (modifierMap[code]) {
      return modifierMap[code];
    }

    // Handle punctuation and special characters
    const punctuationMap: Record<string, string> = {
      Semicolon: ";",
      Equal: "=",
      Comma: ",",
      Minus: "-",
      Period: ".",
      Slash: "/",
      Backquote: "`",
      BracketLeft: "[",
      Backslash: "\\",
      BracketRight: "]",
      Quote: "'",
    };

    if (punctuationMap[code]) {
      return punctuationMap[code];
    }

    // For any other codes, try to convert to a reasonable format
    return code.toLowerCase().replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  // Fallback to e.key if e.code is not available
  if (e.key) {
    const key = e.key;

    // Handle special key names with OS-specific formatting
    const keyMap: Record<string, string> = {
      Control: osType === "macos" ? "ctrl" : "ctrl",
      Alt: osType === "macos" ? "option" : "alt",
      Shift: "shift",
      Meta:
        osType === "macos" ? "command" : osType === "windows" ? "win" : "super",
      OS:
        osType === "macos" ? "command" : osType === "windows" ? "win" : "super",
      CapsLock: "caps lock",
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Escape: "esc",
      " ": "space",
    };

    if (keyMap[key]) {
      return keyMap[key];
    }

    return key.toLowerCase();
  }

  // Last resort fallback
  return `unknown-${e.keyCode || e.which || 0}`;
};

/**
 * Extract a consistent button name from a MouseEvent
 * Returns standardized mouse button names that match the backend format
 */
export const getMouseButtonName = (e: MouseEvent): string | null => {
  // e.button values:
  // 0: Left button (primary)
  // 1: Middle button (wheel click)
  // 2: Right button (secondary)
  // 3: Back button (XButton1) - typically "Mouse 4"
  // 4: Forward button (XButton2) - typically "Mouse 5"
  switch (e.button) {
    case 0:
      return "mouseleft"; // Left button - usually not used for shortcuts
    case 1:
      return "mousemiddle"; // Middle button
    case 2:
      return "mouseright"; // Right button - usually not used for shortcuts
    case 3:
      return "mouse4"; // Back/XButton1
    case 4:
      return "mouse5"; // Forward/XButton2
    default:
      // Handle any additional mouse buttons
      return `mouse${e.button + 1}`;
  }
};

/**
 * Check if an input name represents a mouse button
 */
export const isMouseButton = (inputName: string): boolean => {
  const lower = inputName.toLowerCase();
  return (
    lower.startsWith("mouse") ||
    lower === "mouseleft" ||
    lower === "mouseright" ||
    lower === "mousemiddle"
  );
};

/**
 * Get display-friendly key combination string for the current OS
 * Returns basic plus-separated format with correct platform key names
 */
export const formatKeyCombination = (
  combination: string,
  osType: OSType,
): string => {
  // Simply return the combination as-is since getKeyName already provides
  // the correct platform-specific key names
  return combination;
};

/**
 * Get display-friendly name for a mouse button
 */
export const getMouseButtonDisplayName = (buttonName: string): string => {
  const displayNames: Record<string, string> = {
    mouseleft: "Left Click",
    mouseright: "Right Click",
    mousemiddle: "Middle Click",
    mouse1: "Left Click",
    mouse2: "Right Click",
    mouse3: "Middle Click",
    mouse4: "Mouse 4",
    mouse5: "Mouse 5",
    mouseforward: "Mouse Forward",
    mouseback: "Mouse Back",
  };

  const lower = buttonName.toLowerCase();
  if (displayNames[lower]) {
    return displayNames[lower];
  }

  // Handle any other mouse button numbers
  const match = lower.match(/^mouse(\d+)$/);
  if (match) {
    return `Mouse ${match[1]}`;
  }

  return buttonName;
};

/**
 * Format an input element (key or mouse button) for display
 */
export const formatInputDisplay = (inputName: string): string => {
  if (isMouseButton(inputName)) {
    return getMouseButtonDisplayName(inputName);
  }
  // Capitalize first letter of each word for keyboard keys
  return inputName
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

/**
 * Normalize modifier keys to handle left/right variants
 */
export const normalizeKey = (key: string): string => {
  // Handle left/right variants of modifier keys
  if (key.startsWith("left ") || key.startsWith("right ")) {
    const parts = key.split(" ");
    if (parts.length === 2) {
      // Return just the modifier name without left/right prefix
      return parts[1];
    }
  }
  return key;
};

