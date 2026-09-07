import { Alert } from "react-native";

// Two-button confirmation dialog. Android silently drops buttons beyond the
// third and cannot Back out of a non-cancelable alert, so this never grows past
// Cancel + one action and is always cancelable.
export function confirm(title, message, {
  confirmText = "OK",
  cancelText = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
} = {}) {
  Alert.alert(
    title,
    message,
    [
      { text: cancelText, style: "cancel", onPress: onCancel },
      { text: confirmText, style: destructive ? "destructive" : "default", onPress: onConfirm },
    ],
    { cancelable: true, onDismiss: onCancel },
  );
}
