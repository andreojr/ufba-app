import type { JSX } from "react";
import { Toast, type ToastComponentProps, type ToastShowOptions } from "heroui-native";
import { View } from "react-native";

interface DangerToastOptions {
  label: string;
  description?: string;
  icon?: JSX.Element;
}

/**
 * heroui-native's `toast.show({ variant: "danger", ... })` only tints the
 * label text red on the app's neutral toast surface (`--color-overlay`) —
 * see `toast.css`'s `.toast__root`, which never varies by variant. An error
 * has to read as unmistakably wrong at a glance, so this renders a solid red
 * box instead, via the library's "custom component" toast.show() pattern —
 * the only one that can reach the root's background, not just the label.
 */
export function dangerToast({ label, description, icon }: DangerToastOptions): ToastShowOptions {
  return {
    component: (props: ToastComponentProps): JSX.Element => (
      <Toast variant="danger" className="flex-row items-center gap-3 bg-danger" {...props}>
        {icon ?? null}
        <View className="flex-1">
          <Toast.Title className="text-danger-foreground">{label}</Toast.Title>
          {description ? (
            <Toast.Description className="text-danger-foreground/80">{description}</Toast.Description>
          ) : null}
        </View>
      </Toast>
    ),
  };
}
