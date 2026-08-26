import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

import { quadradinhoNoPonto, REMOVER_DO_PLANO, type Retangulo } from "@/lib/drag-grid";
import type { ComponenteProjetado } from "@/lib/types";

export interface ArrastoAtivo {
  componente: ComponenteProjetado;
  semestreAtual: string;
}

interface ArrastoSemestreContextValue {
  arrasto: ArrastoAtivo | null;
  fingerX: SharedValue<number>;
  fingerY: SharedValue<number>;
  iniciar: (arrasto: ArrastoAtivo) => void;
  registrarQuadradinhos: (retangulos: Retangulo[]) => void;
  finalizar: (x: number, y: number) => void;
}

const ArrastoSemestreContext = createContext<ArrastoSemestreContextValue | null>(null);

/**
 * Coordena o arrasto de um CardProjetado até um quadradinho do
 * SemestreDragGrid: os dois vivem em pontos diferentes da árvore (o card
 * dentro da ScrollView da Trajetória, o grid num Modal por cima de tudo) e
 * nenhum é pai do outro — daí o contexto em vez de props. Ver
 * docs/superpowers/specs/2026-08-26-trajetoria-drag-semestre-design.md.
 */
export function ArrastoSemestreProvider({
  onSoltar,
  children,
}: {
  onSoltar: (componente: ComponenteProjetado, destino: string | null) => void;
  children: ReactNode;
}): JSX.Element {
  const [arrasto, setArrasto] = useState<ArrastoAtivo | null>(null);
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  // Ref, não state: os quadradinhos se registram de uma vez a cada abertura
  // do grid (ver SemestreDragGrid), e nada aqui precisa re-renderizar por
  // isso — só finalizar() lê o mapa, no fim do gesto.
  const quadradinhos = useRef<Retangulo[]>([]);

  const iniciar = useCallback((novo: ArrastoAtivo) => {
    quadradinhos.current = [];
    setArrasto(novo);
  }, []);

  const registrarQuadradinhos = useCallback((retangulos: Retangulo[]) => {
    quadradinhos.current = retangulos;
  }, []);

  const finalizar = useCallback(
    (x: number, y: number) => {
      setArrasto((atual) => {
        if (!atual) {
          return null;
        }
        const destino = quadradinhoNoPonto(quadradinhos.current, { x, y });
        if (destino !== null && destino !== atual.semestreAtual) {
          onSoltar(atual.componente, destino === REMOVER_DO_PLANO ? null : destino);
        }
        return null;
      });
    },
    [onSoltar],
  );

  return (
    <ArrastoSemestreContext.Provider
      value={{ arrasto, fingerX, fingerY, iniciar, registrarQuadradinhos, finalizar }}
    >
      {children}
    </ArrastoSemestreContext.Provider>
  );
}

export function useArrastoSemestre(): ArrastoSemestreContextValue {
  const valor = useContext(ArrastoSemestreContext);
  if (!valor) {
    throw new Error("useArrastoSemestre usado fora de ArrastoSemestreProvider");
  }
  return valor;
}
