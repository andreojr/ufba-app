import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { HeroUINativeProvider } from "heroui-native";

import { ArrastoSemestreProvider, useArrastoSemestre } from "@/lib/arrasto-semestre-context";
import { SemestreDragGrid } from "./SemestreDragGrid";
import type { ComponenteProjetado } from "@/lib/types";

const COMPONENTE: ComponenteProjetado = {
  codigo: "MATA60",
  nome: "BANCO DE DADOS",
  cargaHoraria: 68,
  periodo: 4,
  atrasada: false,
  manual: false,
  preRequisitoNaoVerificado: false,
};

function GatilhoDeArrasto(): JSX.Element {
  const { iniciar } = useArrastoSemestre();
  return (
    <Pressable
      testID="iniciar"
      onPress={() => iniciar({ componente: COMPONENTE, semestreAtual: "2026.2" })}
    >
      <Text>iniciar</Text>
    </Pressable>
  );
}

describe("SemestreDragGrid", () => {
  it("não renderiza nada sem arrasto ativo", async () => {
    await render(
      <HeroUINativeProvider>
        <ArrastoSemestreProvider onSoltar={jest.fn()}>
          <SemestreDragGrid semestresProjetados={["2026.2", "2027.1"]} />
        </ArrastoSemestreProvider>
      </HeroUINativeProvider>,
    );

    expect(screen.queryByTestId("semestre-drag-grid")).toBeNull();
  });

  it("mostra um quadradinho por semestre projetado mais o pontilhado extra", async () => {
    await render(
      <HeroUINativeProvider>
        <ArrastoSemestreProvider onSoltar={jest.fn()}>
          <GatilhoDeArrasto />
          <SemestreDragGrid semestresProjetados={["2026.2", "2027.1"]} />
        </ArrastoSemestreProvider>
      </HeroUINativeProvider>,
    );

    await act(async () => fireEvent.press(screen.getByTestId("iniciar")));

    expect(screen.getByTestId("semestre-drag-grid")).toBeTruthy();
    expect(screen.getByTestId("quadrado-2026.2")).toBeTruthy();
    expect(screen.getByTestId("quadrado-2027.1")).toBeTruthy();
    // Próximo depois de 2027.1 é 2027.2 — o pontilhado extra.
    expect(screen.getByTestId("quadrado-2027.2")).toBeTruthy();
  });
});
