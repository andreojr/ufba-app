import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import type { JSX } from "react";

import { ArrastoSemestreProvider, useArrastoSemestre } from "./arrasto-semestre-context";
import { REMOVER_DO_PLANO } from "./drag-grid";
import type { ComponenteProjetado } from "./types";

const COMPONENTE: ComponenteProjetado = {
  codigo: "MATA60",
  nome: "BANCO DE DADOS",
  cargaHoraria: 68,
  periodo: 4,
  atrasada: false,
  manual: false,
  preRequisitoNaoVerificado: false,
};

/** Expõe os métodos do contexto como botões, pra exercitar sem depender de gesto real. */
function Sonda(): JSX.Element {
  const { arrasto, iniciar, registrarQuadradinhos, finalizar } = useArrastoSemestre();
  return (
    <>
      <Text testID="estado">{arrasto ? arrasto.componente.codigo : "nenhum"}</Text>
      <Pressable
        testID="iniciar"
        onPress={() => iniciar({ componente: COMPONENTE, semestreAtual: "2026.2" })}
      >
        <Text>iniciar</Text>
      </Pressable>
      <Pressable
        testID="registrar"
        onPress={() =>
          registrarQuadradinhos([{ id: "2027.1", x: 0, y: 0, width: 100, height: 100 }])
        }
      >
        <Text>registrar</Text>
      </Pressable>
      <Pressable
        testID="registrar-remover"
        onPress={() =>
          registrarQuadradinhos([{ id: REMOVER_DO_PLANO, x: 0, y: 0, width: 100, height: 100 }])
        }
      >
        <Text>registrar remover</Text>
      </Pressable>
      <Pressable testID="soltar-dentro" onPress={() => finalizar(50, 50)}>
        <Text>soltar dentro</Text>
      </Pressable>
      <Pressable testID="soltar-fora" onPress={() => finalizar(999, 999)}>
        <Text>soltar fora</Text>
      </Pressable>
    </>
  );
}

async function pressionar(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

describe("ArrastoSemestreProvider", () => {
  it("chama onSoltar com o destino quando solta dentro de um quadradinho registrado", async () => {
    const onSoltar = jest.fn();
    await render(
      <ArrastoSemestreProvider onSoltar={onSoltar}>
        <Sonda />
      </ArrastoSemestreProvider>,
    );

    await pressionar("iniciar");
    expect(screen.getByTestId("estado")).toHaveTextContent("MATA60");

    await pressionar("registrar");
    await pressionar("soltar-dentro");

    expect(onSoltar).toHaveBeenCalledWith(COMPONENTE, "2027.1");
    expect(screen.getByTestId("estado")).toHaveTextContent("nenhum");
  });

  it("não chama onSoltar quando solta fora de qualquer quadradinho", async () => {
    const onSoltar = jest.fn();
    await render(
      <ArrastoSemestreProvider onSoltar={onSoltar}>
        <Sonda />
      </ArrastoSemestreProvider>,
    );

    await pressionar("iniciar");
    await pressionar("registrar");
    await pressionar("soltar-fora");

    expect(onSoltar).not.toHaveBeenCalled();
    expect(screen.getByTestId("estado")).toHaveTextContent("nenhum");
  });

  it("chama onSoltar com semestre null quando solta no quadradinho de tirar do plano", async () => {
    const onSoltar = jest.fn();
    await render(
      <ArrastoSemestreProvider onSoltar={onSoltar}>
        <Sonda />
      </ArrastoSemestreProvider>,
    );

    await pressionar("iniciar");
    await pressionar("registrar-remover");
    await pressionar("soltar-dentro");

    expect(onSoltar).toHaveBeenCalledWith(COMPONENTE, null);
    expect(screen.getByTestId("estado")).toHaveTextContent("nenhum");
  });

  it("não chama onSoltar ao soltar sobre o próprio semestre atual", async () => {
    const onSoltar = jest.fn();
    await render(
      <ArrastoSemestreProvider onSoltar={onSoltar}>
        <Sonda />
      </ArrastoSemestreProvider>,
    );

    await pressionar("iniciar");
    // registra "2027.1"; agora sobrescreve pro semestre atual
    await pressionar("registrar");
    // Redefine o único retângulo registrado para o próprio semestre atual do arrasto.
    await pressionar("registrar");

    expect(onSoltar).not.toHaveBeenCalled();
  });
});
