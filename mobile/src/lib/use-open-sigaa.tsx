import { useRouter } from "expo-router";
import { useThemeColor, useToast } from "heroui-native";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppIcon } from "@/components/AppIcon";
import { describeApiError } from "@/lib/api-errors";
import { postSigaaSession } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSigaaLink } from "@/lib/sigaa-link-context";
import { useIsSigaaWebviewOpen } from "@/lib/sigaa-webview-state";
import { getSigaaCredentials } from "@/lib/sigaa-storage";
import { dangerToast } from "@/lib/toast-helpers";

/**
 * Mints a SIGAA session and opens it in the webview popup. Shared by every
 * entry point that can open SIGAA (the home screen used to own this, now the
 * tab bar's dedicated SIGAA button does) so there's exactly one place that
 * knows how that handshake works.
 *
 * `isOpening` stays true from the moment the button is tapped until the
 * webview popup actually closes — not just until the session-minting round
 * trip finishes — so a rapid double-tap can't fire two session mints and
 * push the popup twice. `openingRef` backs the guard with a plain ref rather
 * than the `isOpening` state alone, since the state update from the first
 * tap isn't guaranteed to have committed before a second tap lands.
 */
export function useOpenSigaa(): { isOpening: boolean; openSigaa: () => Promise<void> } {
  const router = useRouter();
  const auth = useAuth();
  const sigaaLink = useSigaaLink();
  const { toast } = useToast();
  const dangerForeground = useThemeColor("danger-foreground");
  const [isOpening, setIsOpening] = useState(false);
  const openingRef = useRef(false);
  const isWebviewOpen = useIsSigaaWebviewOpen();
  const wasWebviewOpenRef = useRef(false);

  const accessToken = auth.status === "signedIn" ? auth.accessToken : null;

  // The webview screen lives on the other side of a `router.push`, so this
  // is how we find out it closed: watch the shared store for the true → false
  // transition and unblock the button then, instead of right after the push.
  useEffect(() => {
    if (wasWebviewOpenRef.current && !isWebviewOpen) {
      openingRef.current = false;
      setIsOpening(false);
    }
    wasWebviewOpenRef.current = isWebviewOpen;
  }, [isWebviewOpen]);

  const openSigaa = useCallback(async () => {
    if (openingRef.current) {
      return;
    }
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

    openingRef.current = true;
    setIsOpening(true);
    try {
      const session = await postSigaaSession(accessToken, credentials);
      router.push({
        pathname: "/sigaa-webview",
        params: { sessionCookie: session.sessionCookie, targetUrl: session.targetUrl },
      });
      // Left blocked on purpose: the effect above clears it once the
      // webview reports itself closed.
    } catch (error) {
      console.warn("Failed to open SIGAA", error);
      toast.show(
        dangerToast({
          label: describeApiError(error),
          icon: <AppIcon name="IconErrorCircle" size={20} color={dangerForeground} />,
        })
      );
      openingRef.current = false;
      setIsOpening(false);
    }
  }, [accessToken, sigaaLink.status, router, toast, dangerForeground]);

  return { isOpening, openSigaa };
}
