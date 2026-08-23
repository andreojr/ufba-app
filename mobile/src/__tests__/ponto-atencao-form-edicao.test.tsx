import { act, fireEvent, render, waitFor } from "@testing-library/react-native";

import { PontoAtencaoForm } from "@/components/PontoAtencaoForm";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Text, TextInput, TouchableOpacity, View } = jest.requireActual("react-native");

  return {
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => "#000000") : "#000000",
    Button: ({ children, onPress, isDisabled, testID }: any) => (
      <TouchableOpacity onPress={onPress} disabled={isDisabled} testID={testID} accessibilityRole="button">
        {typeof children === "string" ? <Text>{children}</Text> : children}
      </TouchableOpacity>
    ),
    Typography: {
      Paragraph: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    },
    TextField: ({ children }: any) => <View>{children}</View>,
    Label: ({ children }: any) => <Text>{children}</Text>,
    FieldError: ({ children, testID }: any) => <Text testID={testID}>{children}</Text>,
    Input: ({ testID, value, onChangeText, placeholder, keyboardType, maxLength }: any) => (
      <TextInput
        testID={testID}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        maxLength={maxLength}
      />
    ),
  };
});

describe("PontoAtencaoForm — edição de item com data no passado (fix 8)", () => {
  it("não bloqueia salvar um item em edição cuja data já passou", async () => {
    const onSalvar = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await render(
      <PontoAtencaoForm
        turmaId="turma-1"
        turmas={[]}
        valorInicial={{
          tipo: "PROVA",
          titulo: "Avaliação I",
          data: "2020-01-01",
          hora: null,
          observacao: null,
        }}
        salvarRotulo="Salvar alterações"
        onSalvar={onSalvar}
      />,
    );

    // A data já vem preenchida (mascarada) a partir do valorInicial passado —
    // nem precisa ser reescrita para provar que ela não é rejeitada.
    expect(getByTestId("campo-data").props.value).toBe("01/01/2020");

    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I corrigida");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    await waitFor(() => expect(onSalvar).toHaveBeenCalled());
    expect(queryByTestId("erro-data")).toBeNull();
    expect(onSalvar).toHaveBeenCalledWith(
      "turma-1",
      expect.objectContaining({ data: "2020-01-01" }),
    );
  });
});

describe("PontoAtencaoForm — cadastro ainda recusa data no passado (fix 8, guarda de regressão)", () => {
  it("continua bloqueando ao criar (sem valorInicial) com data no passado", async () => {
    const onSalvar = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await render(
      <PontoAtencaoForm turmaId="turma-1" turmas={[]} onSalvar={onSalvar} />,
    );

    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-data"), "01/01/2020");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    expect(onSalvar).not.toHaveBeenCalled();
    expect(queryByTestId("erro-data")).toBeTruthy();
  });
});

describe("PontoAtencaoForm — validação de hora (fix 10)", () => {
  it("recusa salvar com uma hora incompleta e mostra o erro", async () => {
    const onSalvar = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await render(
      <PontoAtencaoForm turmaId="turma-1" turmas={[]} onSalvar={onSalvar} />,
    );

    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-data"), "22/09/2026");
    });
    await act(async () => {
      // A máscara não bloqueia um único dígito ainda sem os dois-pontos.
      fireEvent.changeText(getByTestId("campo-hora"), "1");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    expect(onSalvar).not.toHaveBeenCalled();
    expect(queryByTestId("erro-hora")).toBeTruthy();
  });

  it("recusa uma hora fora do intervalo do relógio (99:99)", async () => {
    const onSalvar = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await render(
      <PontoAtencaoForm turmaId="turma-1" turmas={[]} onSalvar={onSalvar} />,
    );

    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-data"), "22/09/2026");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-hora"), "9999");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    expect(onSalvar).not.toHaveBeenCalled();
    expect(queryByTestId("erro-hora")).toBeTruthy();
  });

  it("aceita salvar sem hora nenhuma (campo opcional)", async () => {
    const onSalvar = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await render(
      <PontoAtencaoForm turmaId="turma-1" turmas={[]} onSalvar={onSalvar} />,
    );

    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-data"), "22/09/2026");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    await waitFor(() => expect(onSalvar).toHaveBeenCalled());
    expect(queryByTestId("erro-hora")).toBeNull();
  });

  it("aceita uma hora válida", async () => {
    const onSalvar = jest.fn().mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await render(
      <PontoAtencaoForm turmaId="turma-1" turmas={[]} onSalvar={onSalvar} />,
    );

    await act(async () => {
      fireEvent.changeText(getByTestId("campo-titulo"), "Avaliação I");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-data"), "22/09/2026");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("campo-hora"), "1640");
    });
    await act(async () => {
      fireEvent.press(getByTestId("salvar-ponto"));
    });

    await waitFor(() =>
      expect(onSalvar).toHaveBeenCalledWith("turma-1", expect.objectContaining({ hora: "16:40" })),
    );
    expect(queryByTestId("erro-hora")).toBeNull();
  });
});
