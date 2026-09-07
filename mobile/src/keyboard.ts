import { useEffect, useState } from "react";
import { Keyboard, Platform, type KeyboardEventName } from "react-native";

export interface KeyboardEvents {
  show: KeyboardEventName;
  hide: KeyboardEventName;
}

// iOS gets the Will pair so the layout moves with the keyboard animation.
// Android only ever emits the Did pair, so asking for Will there would mean
// never hearing about the keyboard at all.
export function keyboardEvents(os: string): KeyboardEvents {
  return os === "ios"
    ? { show: "keyboardWillShow", hide: "keyboardWillHide" }
    : { show: "keyboardDidShow", hide: "keyboardDidHide" };
}

const { show: SHOW, hide: HIDE } = keyboardEvents(Platform.OS);

// True while the software keyboard is on screen, so a layout can give up
// vertical space rather than let the keyboard cover what is being typed into.
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const shown = Keyboard.addListener(SHOW, () => setVisible(true));
    const hidden = Keyboard.addListener(HIDE, () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return visible;
}

export type AvoidBehavior = "padding" | "height";

// Which KeyboardAvoidingView behaviour a platform needs. Every avoiding view
// in the app goes through this so the three of them cannot drift apart again:
// they were once all disabled on Android, on the assumption that
// windowSoftInputMode=adjustResize would shrink the window. Edge-to-edge stops
// that happening, so Android needs "height" rather than nothing at all.
export function keyboardAvoidBehavior(os: string): AvoidBehavior {
  return os === "ios" ? "padding" : "height";
}
