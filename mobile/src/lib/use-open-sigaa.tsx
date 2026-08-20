import { useRouter } from "expo-router";
import { useThemeColor, useToast } from "heroui-native";
import { useCallback, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import { describeApiError } from "@/lib/api-errors";
import { postSigaaSession } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { getSigaaCredentials } from "@/lib/sigaa-storage";

/**
 * Mints a SIGAA session and opens it in the webview popup. Shared by every
 * entry point that can open SIGAA (the home screen used to own this, now the
 * tab bar's dedicated SIGAA button does) so there's exactly one place that
 * knows how that handshake works.
 */
export function useOpenSigaa(): { isOpening: boolean; openSigaa: () => Promise<void> } {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const { toast } = useToast();
  const dangerSoftForeground = useThemeColor("danger-soft-foreground");
  const [isOpening, setIsOpening] = useState(false);

  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;

  const openSigaa = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    if (sigaaLink.status !== "linked") {
      router.push("/link-account");
      return;
    }

    const credentials = await getSigaaCredentials();
    if (!credentials) {
      router.push("/link-account");
      return;
    }

    setIsOpening(true);
    try {
      const session = await postSigaaSession(accessToken, credentials);
      router.push({
        pathname: "/sigaa-webview",
        params: { sessionCookie: session.sessionCookie, targetUrl: session.targetUrl },
      });
    } catch (error) {
      console.warn("Failed to open SIGAA", error);
      toast.show({
        variant: "danger",
        label: describeApiError(error),
        icon: <AppIcon name="IconErrorCircle" size={20} color={dangerSoftForeground} />,
      });
    } finally {
      setIsOpening(false);
    }
  }, [accessToken, sigaaLink.status, router, toast, dangerSoftForeground]);

  return { isOpening, openSigaa };
}
