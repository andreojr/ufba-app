import { useCallback, useMemo, useState, type JSX } from "react";
import { View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, type GestureType } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { BottomTabBar } from "@/components/BottomTabBar";
import { TabsHeader } from "@/components/TabsHeader";
import { tocouDentroDaArea } from "@/lib/gesture-bounds";
import { direcaoDoSwipe } from "@/lib/trajetoria";
import { TabSwipeRegistryProvider, type AreaBloqueada } from "@/lib/tab-swipe-context";
import HomeTab from "@/screens/HomeTab";
import InsightsTab from "@/screens/InsightsTab";
import ProfessoresScreen from "@/screens/ProfessoresScreen";
import TrajetoriaTab from "@/screens/TrajetoriaTab";

/**
 * The four real tabs (Início, Trajetória, Insights, Professores), side by
 * side in one horizontal track the user can drag between — like Instagram's
 * feed/reels swipe — with `BottomTabBar` sliding and crossfading in step.
 *
 * This replaces what used to be Expo Router's `<Tabs>` navigator for these
 * four screens: React Navigation's bottom-tabs has no swipe of its own (that
 * needs a pager-backed navigator, e.g. material-top-tabs), and nothing here
 * ever deep-links to `/trajetoria`, `/insights`, or `/professores` directly —
 * they're only ever reached from this bar — so there's nothing lost by
 * mounting all four as plain sibling components instead of navigator routes.
 * The one real trade-off: all four now fetch their own data up front, at this
 * screen's mount, rather than one at a time as the user first visits each
 * tab. `ajustes` (Perfil) still is a real route — see `(tabs)/_layout.tsx`.
 */
export default function TabsPager(): JSX.Element {
  const { width: pageWidth } = useWindowDimensions();

  // `paginaAtual` (settled index, 0-3) + `arrasto` (live drag offset in
  // pixels) is the same split insights.tsx's own CR/Carga-Horária swipe
  // uses, one level up — see its estiloTrilha for the identical pattern.
  const paginaAtual = useSharedValue(0);
  const arrasto = useSharedValue(0);
  const [activePage, setActivePage] = useState(0);

  // Continuous page position for BottomTabBar — 0..3, fractional mid-drag —
  // derived rather than tracked separately so there's one source of truth.
  const progress = useDerivedValue(() => paginaAtual.value - arrasto.value / pageWidth);

  const estiloTrilha = useAnimatedStyle(() => ({
    transform: [{ translateX: -paginaAtual.value * pageWidth + arrasto.value }],
  }));

  // Gestures registered by child screens (currently Insights' own
  // CR/Carga-Horária swipe plus its charts' and carousel's native scroll
  // gestures) that this pager's swipe must lose to — see tab-swipe-context's
  // docstring for why the native ones matter just as much as the Pan one.
  const [blockingGestures, setBlockingGestures] = useState<GestureType[]>([]);
  // Areas (charts, the "peso das notas" carousel) a touch can start inside
  // and later drift outside of — a gesture race alone doesn't cover that
  // (it only helps once the nested gesture actually recognizes, which a
  // chart with too little content to scroll never does), so the pager fails
  // itself on touch-down for any of these regardless. See tab-swipe-context.
  const [blockingAreas, setBlockingAreas] = useState<AreaBloqueada[]>([]);

  // Memoized like insights.tsx's own swipeInsight — a fresh `Gesture.Pan()`
  // on every render (this component re-renders on every completed swipe, via
  // setActivePage) means GestureDetector tears down and rebuilds the native
  // handler each time, instead of reusing one stable instance. A few swipes
  // in, that repeated rebuild is what surfaced as a `WorkletsError` crash.
  /*
   * Reanimated: escrever em `.value` é a ÚNICA forma de mover um shared value,
   * e o React Compiler não modela esse tipo — para ele, toda escrita abaixo é
   * mutação proibida. Não é: acontecem na UI thread, dentro de worklets de
   * gesto, e não tocam estado do React. Desligado no gesto inteiro em vez de
   * linha a linha, porque são todas a mesma escrita.
   */
  /* eslint-disable react-hooks/immutability */
  const swipePagina = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-10, 10])
        .requireExternalGestureToFail(...blockingGestures)
        .onTouchesDown((evento, manager) => {
          "worklet";
          for (const area of blockingAreas) {
            if (tocouDentroDaArea(evento, area)) {
              manager.fail();
              return;
            }
          }
        })
        .onChange((evento) => {
          let x = evento.translationX;
          if (paginaAtual.value === 0 && x > 0) {
            x = 0;
          }
          if (paginaAtual.value === 3 && x < 0) {
            x = 0;
          }
          arrasto.value = x;
        })
        .onEnd((evento) => {
          const direcao = direcaoDoSwipe(evento.translationX, evento.translationY);
          const atual = paginaAtual.value;
          let proxima = atual;
          if (direcao === "esquerda" && atual < 3) {
            proxima = atual + 1;
          } else if (direcao === "direita" && atual > 0) {
            proxima = atual - 1;
          }
          paginaAtual.value = withTiming(proxima, { duration: 220 });
          arrasto.value = withTiming(0, { duration: 220 });
          if (proxima !== atual) {
            scheduleOnRN(setActivePage, proxima);
          }
        }),
    [blockingGestures, blockingAreas, paginaAtual, arrasto],
  );
  /* eslint-enable react-hooks/immutability */

  const onSelectPage = useCallback(
    (page: number) => {
      // Mesmo caso do gesto acima: `.value` é a interface do shared value, e a
      // escrita roda no toque, não no render.
      // eslint-disable-next-line react-hooks/immutability
      paginaAtual.value = withTiming(page, { duration: 220 });
      setActivePage(page);
    },
    [paginaAtual],
  );

  return (
    <View className="flex-1">
      {/* One header for all four tabs, instead of each drawing its own —
          the cog/avatar used to remount (and visibly flicker) on every
          swipe since each tab's AppBar was a fresh instance. Only the
          title itself animates now — see TabsHeader/AnimatedPageTitle. */}
      <TabsHeader activePage={activePage} />
      <View className="flex-1 overflow-hidden">
        <TabSwipeRegistryProvider onGesturesChange={setBlockingGestures} onAreasChange={setBlockingAreas}>
          <GestureDetector gesture={swipePagina}>
            <Animated.View style={[{ flex: 1, flexDirection: "row", width: pageWidth * 4 }, estiloTrilha]}>
              <View style={{ width: pageWidth }}>
                <HomeTab />
              </View>
              <View style={{ width: pageWidth }}>
                <TrajetoriaTab />
              </View>
              <View style={{ width: pageWidth }}>
                <InsightsTab />
              </View>
              <View style={{ width: pageWidth }}>
                <ProfessoresScreen />
              </View>
            </Animated.View>
          </GestureDetector>
        </TabSwipeRegistryProvider>
      </View>
      <BottomTabBar progress={progress} activePage={activePage} onSelectPage={onSelectPage} />
    </View>
  );
}
