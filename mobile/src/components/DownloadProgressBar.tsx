import { Typography } from "heroui-native";
import { useEffect, useState, type JSX } from "react";
import { View } from "react-native";

import { downloadProgress, type ProgressStage } from "@/lib/download-progress";

/**
 * The download is a single opaque POST, so there is no real progress signal
 * to render — instead the bar walks the backend's actual stages at their
 * typical pace (see download-progress.ts) and parks near the end if SIGAA is
 * slower than usual. Completion is signaled by the card leaving "busy", never
 * by the bar reaching 100% on its own.
 */
export function DownloadProgressBar({ stages }: { stages: ProgressStage[] }): JSX.Element {
  const [progress, setProgress] = useState(() => downloadProgress(0, stages));

  useEffect(() => {
    // Elapsed time is accumulated per tick (not Date.now()) so the bar is
    // driven purely by the timer — slight drift is irrelevant for a
    // calibrated estimate, and it keeps the component testable under fake
    // timers that don't mock Date.
    const tickMs = 120;
    let elapsedMs = 0;
    const timer = setInterval(() => {
      elapsedMs += tickMs;
      setProgress(downloadProgress(elapsedMs, stages));
    }, tickMs);
    return () => clearInterval(timer);
  }, [stages]);

  return (
    <View className="gap-2">
      <View className="h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
        <View
          className="h-full rounded-full bg-accent"
          style={{ width: `${progress.fraction * 100}%` }}
        />
      </View>
      <Typography.Paragraph type="body-xs" color="muted">
        {progress.label}
      </Typography.Paragraph>
    </View>
  );
}
