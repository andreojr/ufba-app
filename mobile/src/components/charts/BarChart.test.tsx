import { render, screen } from "@testing-library/react-native";

import { BarChart } from "./BarChart";

jest.mock("heroui-native", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    useThemeColor: () => "#7C3AED",
    Typography: {
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
  };
});

describe("BarChart", () => {
  it("labels every bar with its hours and rótulo", async () => {
    await render(
      <BarChart
        barras={[
          { rotulo: "2025.1", valor: 120 },
          { rotulo: "2025.2", valor: 68 },
        ]}
      />,
    );

    expect(screen.getByText("120 h")).toBeTruthy();
    expect(screen.getByText("68 h")).toBeTruthy();
    expect(screen.getByText("2025.1")).toBeTruthy();
    expect(screen.getByText("2025.2")).toBeTruthy();
  });

  it("renders nothing for an empty series rather than crashing on the scale math", async () => {
    await render(<BarChart barras={[]} />);

    expect(screen.getByTestId("bar-chart-vazio")).toBeTruthy();
  });
});
