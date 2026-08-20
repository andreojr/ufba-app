import { render, screen } from "@testing-library/react-native";

import ProfessorDetalhe from "@/app/professor/[siape]";
import { getDocente } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { DocentePerfil } from "@/lib/types";

jest.mock("@/lib/auth-context");
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  getDocente: jest.fn(),
}));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ siape: "1815041" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

jest.mock("@/components/AppBar", () => ({ AppBar: () => null }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Text, View } = jest.requireActual("react-native");
  return {
    Spinner: () => <View />,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children, onPress }: any) => <Text onPress={onPress}>{children}</Text>,
    },
    useThemeColor: () => "#888888",
  };
});

const mockedGet = getDocente as jest.MockedFunction<typeof getDocente>;
const mockedAuth = useAuth as jest.MockedFunction<typeof useAuth>;

function perfil(overrides: Partial<DocentePerfil> = {}): DocentePerfil {
  return {
    siape: "1815041",
    nome: "ANTONIO LOPES APOLINARIO JUNIOR",
    departamento: "DCC",
    unidade: "IC",
    descricaoPessoal: null,
    formacao: [],
    areasInteresse: [],
    lattesUrl: null,
    enderecoProfissional: null,
    sala: "IC- 2012",
    telefone: "6299",
    email: "antonio.apolinario@ufba.br",
    disciplinas: [
      { semestre: "2026.2", codigo: "MATA65", nome: "COMPUTAÇÃO GRÁFICA", cargaHoraria: 60, horario: "24T34" },
      { semestre: "2026.1", codigo: "MATA65", nome: "COMPUTAÇÃO GRÁFICA", cargaHoraria: 60, horario: "24T34" },
    ],
    tccsOrientados: [],
    orientacoes: {
      mestradoAndamento: 0, mestradoConcluidas: 0,
      doutoradoAndamento: 0, doutoradoConcluidas: 0,
    },
    ...overrides,
  };
}

describe("Professor detail screen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedAuth.mockReturnValue({ accessToken: "token" } as ReturnType<typeof useAuth>);
  });

  it("leads with contact, the field that is almost always filled", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText("IC- 2012")).toBeTruthy();
    expect(screen.getByText("antonio.apolinario@ufba.br")).toBeTruthy();
  });

  it("groups the courses taught by term", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText("2026.2")).toBeTruthy();
    expect(screen.getByText("2026.1")).toBeTruthy();
  });

  // The empty profile is the common case — the screen must not show hollow
  // section headers for data that does not exist.
  it("omits the sections with no data instead of rendering them empty", async () => {
    mockedGet.mockResolvedValue(perfil());
    await render(<ProfessorDetalhe />);
    await screen.findByText("IC- 2012");
    expect(screen.queryByText("Formação")).toBeNull();
    expect(screen.queryByText("Áreas de interesse")).toBeNull();
    expect(screen.queryByText("Orientações")).toBeNull();
  });

  it("shows the profile extras when the docente did fill them in", async () => {
    mockedGet.mockResolvedValue(
      perfil({
        formacao: ["Bacharel em Ciência da Computação"],
        areasInteresse: ["Computação Gráfica"],
        lattesUrl: "http://lattes.cnpq.br/123",
        orientacoes: {
          mestradoAndamento: 2, mestradoConcluidas: 5,
          doutoradoAndamento: 1, doutoradoConcluidas: 0,
        },
      }),
    );
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText("Formação")).toBeTruthy();
    expect(screen.getByText("Computação Gráfica")).toBeTruthy();
    expect(screen.getByText("Orientações")).toBeTruthy();
  });

  it("shows an error state when the profile cannot be loaded", async () => {
    mockedGet.mockRejectedValue(new Error("boom"));
    await render(<ProfessorDetalhe />);
    expect(await screen.findByText(/não foi possível/i)).toBeTruthy();
  });
});
