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

  it("widens the container by its own horizontal padding, so the last bar isn't shorted off the scrollable area", async () => {
    await render(
      <BarChart barras={Array.from({ length: 12 }, (_, i) => ({ rotulo: `202${i}`, valor: 60 }))} />,
    );

    // 12 bars × 56px of point spacing = 672px of columns. The container has
    // to add both 8px margins on top of that — sizing it to exactly 672 lets
    // its own horizontal padding eat into the columns' space instead, which
    // pushed the last bar past the end of the scrollable area entirely.
    const container = screen.getByTestId("bar-chart");
    expect(container.props.style.width).toBe(672 + 16);
  });

  it("renders nothing for an empty series rather than crashing on the scale math", async () => {
    await render(<BarChart barras={[]} />);

    expect(screen.getByTestId("bar-chart-vazio")).toBeTruthy();
  });
});
