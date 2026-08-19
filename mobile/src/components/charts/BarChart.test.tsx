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

  it("scrolls horizontally rather than squeezing every term into the screen's width", async () => {
    await render(
      <BarChart barras={Array.from({ length: 12 }, (_, i) => ({ rotulo: `202${i}`, valor: 60 }))} />,
    );

    expect(screen.getByTestId("bar-chart-scroll")).toBeTruthy();
  });

  it("sizes the container to exactly its columns' width — no x margin to eat into it", async () => {
    await render(
      <BarChart barras={Array.from({ length: 12 }, (_, i) => ({ rotulo: `202${i}`, valor: 60 }))} />,
    );

    // 12 bars × 56px of point spacing = 672px of columns, with nothing else
    // added: unlike the line chart's points, a bar reads as its own shape
    // right up to the edge, so no x margin should be shorting these columns
    // (that's exactly the overflow bug this width once had).
    const container = screen.getByTestId("bar-chart");
    expect(container.props.style.width).toBe(672);
  });

  it("renders nothing for an empty series rather than crashing on the scale math", async () => {
    await render(<BarChart barras={[]} />);

    expect(screen.getByTestId("bar-chart-vazio")).toBeTruthy();
  });
});
