import { fireEvent, render, screen } from "@testing-library/react-native";

import { DocenteCard } from "@/components/DocenteCard";
import type { DocenteResumo } from "@/lib/types";

// heroui-native has to be mocked by hand in this codebase — see
// trajetoria.test.tsx. Note Typography is a compound component here:
// Typography.Heading / Typography.Paragraph, never a bare <Typography>.
jest.mock("heroui-native", () => {
  const { Text, View } = jest.requireActual("react-native");
  return {
    Chip: ({ children }: any) => <Text>{children}</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    useThemeColor: () => "#888888",
  };
});

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

function resumo(overrides: Partial<DocenteResumo> = {}): DocenteResumo {
  return {
    nomeOriginal: "ANTONIO LOPES APOLINARIO JUNIOR",
    componentes: [{ codigo: "MATA65", nome: "COMPUTAÇÃO GRÁFICA" }],
    perfil: {
      siape: "1815041",
      nome: "ANTONIO LOPES APOLINARIO JUNIOR",
      departamento: "DEPARTAMENTO DE CIÊNCIA DA COMPUTAÇÃO /IC",
      unidade: null,
      selos: {
        contato: true,
        formacao: true,
        areasInteresse: false,
        lattes: true,
        orientacoes: false,
        semestresLecionando: 8,
      },
    },
    ...overrides,
  };
}

// RTL v14 renders asynchronously in this codebase — `render` must be awaited,
// and the first query after it needs `findBy*`; only then are the plain
// `getBy*`/`queryBy*` calls that follow in the same test safe to use.
describe("DocenteCard", () => {
  it("shows the name and the courses this docente teaches you", async () => {
    await render(<DocenteCard resumo={resumo()} onPress={jest.fn()} />);
    expect(await screen.findByText("ANTONIO LOPES APOLINARIO JUNIOR")).toBeTruthy();
    expect(screen.getByText("MATA65")).toBeTruthy();
  });

  it("advertises what is inside so a tap is never wasted", async () => {
    await render(<DocenteCard resumo={resumo()} onPress={jest.fn()} />);
    expect(await screen.findByText("Contato")).toBeTruthy();
    expect(screen.getByText("Formação")).toBeTruthy();
    expect(screen.getByText("Lattes")).toBeTruthy();
    expect(screen.queryByText("Áreas")).toBeNull();
    expect(screen.getByText("8 semestres")).toBeTruthy();
  });

  it("navigates with the siape when tapped", async () => {
    const onPress = jest.fn();
    await render(<DocenteCard resumo={resumo()} onPress={onPress} />);
    fireEvent.press(await screen.findByRole("button"));
    expect(onPress).toHaveBeenCalledWith("1815041");
  });

  // 1 of 5 docentes on the real atestado had no public record. This state is
  // first-class, not an error.
  it("is disabled and says why when there is no public profile", async () => {
    const onPress = jest.fn();
    await render(<DocenteCard resumo={resumo({ perfil: null })} onPress={onPress} />);
    expect(await screen.findByText("Perfil não disponível no SIGAA")).toBeTruthy();
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("falls back to a singular label for a single term", async () => {
    const base = resumo();
    await render(
      <DocenteCard
        resumo={{ ...base, perfil: { ...base.perfil!, selos: { ...base.perfil!.selos, semestresLecionando: 1 } } }}
        onPress={jest.fn()}
      />,
    );
    expect(await screen.findByText("1 semestre")).toBeTruthy();
  });
});
