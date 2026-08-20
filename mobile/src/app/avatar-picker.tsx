import { useRouter } from "expo-router";
import { Button, Spinner, Typography, useThemeColor, useToast } from "heroui-native";
import { useEffect, useRef, useState, type JSX } from "react";
import { Pressable, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "@/components/AppIcon";
import { describeApiError } from "@/lib/api-errors";
import { useAuth } from "@/lib/auth-context";
import {
  goNext,
  goPrevious,
  initAvatarSeedHistory,
  type AvatarSeedHistoryState,
} from "@/lib/avatar-seed-history";
import { buildAvatarUrl } from "@/lib/dicebear";
import { dangerToast } from "@/lib/toast-helpers";

const SEED_PATTERN = /seed=([^&]+)/;

function extractSeed(avatarUrl: string | null | undefined): string | null {
  return avatarUrl?.match(SEED_PATTERN)?.[1] ?? null;
}

function randomSeed(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * Lets the student pick a fun DiceBear "Open Peeps" avatar instead of uploading a
 * real photo — tap the arrows until one feels right, then "Salvar" persists just the
 * resulting image URL (see backend UsersService, which only accepts DiceBear URLs —
 * this isn't a general-purpose "save any URL" field).
 */
export default function AvatarPickerScreen(): JSX.Element {
  const router = useRouter();
  const auth = useAuth();
  const { toast } = useToast();
  const insets = useSafeAreaInsets();
  const [foregroundColor, dangerForeground] = useThemeColor(["foreground", "danger-foreground"]);

  // Seeds seen so far this session (bounded window, see lib/avatar-seed-history) —
  // lets "seta pra esquerda" step back to an avatar the student already passed
  // without regenerating it (and losing it) via "seta pra direita".
  const [history, setHistory] = useState<AvatarSeedHistoryState>(() =>
    initAvatarSeedHistory(
      extractSeed(auth.status === "signedIn" ? auth.user.avatarUrl : null) ?? randomSeed(),
      randomSeed
    )
  );
  const [isSaving, setIsSaving] = useState(false);
  const currentSeed = history.seeds[history.currentIndex];
  const avatarUrl = buildAvatarUrl(currentSeed);
  const canGoToPrevious = history.currentIndex > 0;

  // Pre-fetched SVG markup per seed, keyed by seed. Populated by the effect below —
  // by the time the student arrives at a seed via the arrows, its markup has
  // (almost always) already loaded in the background, so navigating feels instant.
  const [xmlBySeed, setXmlBySeed] = useState<Record<string, string>>({});
  const requestedSeeds = useRef(new Set<string>());
  // Tracks mount status only — NOT per-effect-run. This effect re-runs on every new
  // seed (i.e. often), and each run's fetches must still be allowed to land even
  // after a later seed triggers the next run; only unmounting should discard them.
  const isMounted = useRef(true);

  useEffect(
    () => () => {
      isMounted.current = false;
    },
    []
  );

  useEffect(() => {
    const toFetch = history.seeds.filter((seed) => !requestedSeeds.current.has(seed));
    if (toFetch.length === 0) {
      return;
    }
    toFetch.forEach((seed) => requestedSeeds.current.add(seed));

    Promise.all(
      toFetch.map((seed) =>
        fetch(buildAvatarUrl(seed))
          .then((response) => response.text())
          .then((xml) => [seed, xml] as const)
          .catch((error: unknown) => {
            console.warn("Failed to preload avatar", error);
            return null;
          })
      )
    ).then((results) => {
      if (!isMounted.current) {
        return;
      }
      const loaded = results.filter((entry): entry is readonly [string, string] => entry !== null);
      if (loaded.length > 0) {
        setXmlBySeed((previous) => ({ ...previous, ...Object.fromEntries(loaded) }));
      }
    });
  }, [history.seeds]);

  const currentXml = xmlBySeed[currentSeed];
  // Blocks "seta pra direita" until the avatar it would move to has actually finished
  // preloading — normally instant since it was fetched ahead of time, but guards the
  // rare case where the student navigates faster than the network responds.
  const nextSeed = history.seeds[history.currentIndex + 1];
  const isNextLoading = nextSeed === undefined || xmlBySeed[nextSeed] === undefined;

  function handlePrevious(): void {
    setHistory((current) => goPrevious(current));
  }

  function handleNext(): void {
    setHistory((current) => goNext(current, randomSeed));
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    try {
      await auth.updateAvatarUrl(avatarUrl);
      router.back();
    } catch (error) {
      console.warn("Failed to save avatar", error);
      toast.show(
        dangerToast({
          label: describeApiError(error),
          icon: <AppIcon name="IconErrorCircle" size={20} color={dangerForeground} />,
        })
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="flex-row items-center justify-between px-6 pb-3.5 self-stretch"
        style={{ paddingTop: insets.top + 14 }}
      >
        <Typography.Heading type="h4">Escolher avatar</Typography.Heading>
        <Pressable testID="avatar-picker-close" onPress={() => router.back()} hitSlop={12}>
          <AppIcon name="IconX" size={24} color={foregroundColor} />
        </Pressable>
      </View>

      <View className="flex-1 items-center justify-center gap-6 px-6">
        <View
          style={{ width: 160, height: 160, borderRadius: 80, overflow: "hidden" }}
          className="items-center justify-center"
        >
          {currentXml ? (
            <SvgXml testID="avatar-preview" xml={currentXml} width={160} height={160} />
          ) : (
            <Spinner testID="avatar-preview-loading" />
          )}
        </View>
        <Typography.Paragraph color="muted" align="center">
          Use as setas até achar um avatar com a sua cara.
        </Typography.Paragraph>
        <View className="flex-row gap-3">
          <Button
            testID="avatar-picker-prev"
            variant="secondary"
            isDisabled={!canGoToPrevious}
            onPress={handlePrevious}
          >
            <AppIcon name="IconCaretLeft" size={20} color={foregroundColor} />
          </Button>
          <Button
            testID="avatar-picker-next"
            variant="secondary"
            isDisabled={isNextLoading}
            onPress={handleNext}
          >
            <AppIcon name="IconCaretRight" size={20} color={foregroundColor} />
          </Button>
        </View>
      </View>

      <View className="gap-2.5 px-6 pt-3.5 bg-background" style={{ paddingBottom: insets.bottom + 24 }}>
        {isSaving ? (
          <View className="h-14 rounded-full bg-accent-soft flex-row items-center justify-center gap-2.5">
            <Spinner />
            <Typography.Paragraph className="text-accent" weight="medium">
              Salvando…
            </Typography.Paragraph>
          </View>
        ) : (
          <Button size="lg" className="w-full" onPress={handleSave}>
            Salvar
          </Button>
        )}
      </View>
    </View>
  );
}
