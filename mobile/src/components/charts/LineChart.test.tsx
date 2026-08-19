import { render, screen } from "@testing-library/react-native";

import { LineChart } from "./LineChart";

jest.mock("heroui-native", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    useThemeColor: () => "#7C3AED",
    Typography: {
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
  };
});

describe("LineChart", () => {
  it("labels every point with its formatted value and rótulo", async () => {
    await render(
      <LineChart
        pontos={[
          { rotulo: "2025.1", valor: 8 },
          { rotulo: "2025.2", valor: 7.5 },
        ]}
      />,
    );

    expect(screen.getByText("8,00")).toBeTruthy();
    expect(screen.getByText("7,50")).toBeTruthy();
    expect(screen.getByText("2025.1")).toBeTruthy();
    expect(screen.getByText("2025.2")).toBeTruthy();
  });

  it("shows an em dash under a term with nothing graded yet", async () => {
    await render(<LineChart pontos={[{ rotulo: "2026.1", valor: null }]} />);

    expect(screen.getByText("—")).toBeTruthy();
  });

  it("renders nothing for an empty series rather than crashing on the scale math", async () => {
    await render(<LineChart pontos={[]} />);

    expect(screen.getByTestId("line-chart-vazio")).toBeTruthy();
  });
});
