import { fireEvent, render } from "@testing-library/react-native";

import { isSyncModeSelectable, SyncModeSelector } from "@/components/SyncModeSelector";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: () => <Text /> };
});

jest.mock("heroui-native", () => {
  const { Text } = jest.requireActual("react-native");

  return {
    useThemeColor: (tokens: string | string[]) =>
      Array.isArray(tokens) ? tokens.map(() => "#000000") : "#000000",
    Chip: ({ children }: any) => <Text>{children}</Text>,
    Typography: {
      Heading: ({ children }: any) => <Text>{children}</Text>,
      Paragraph: ({ children }: any) => <Text>{children}</Text>,
    },
  };
});

describe("SyncModeSelector", () => {
  it("selects the device option when pressed", async () => {
    const onChange = jest.fn();
    const { getByTestId } = await render(<SyncModeSelector value="cloud" onChange={onChange} />);

    fireEvent.press(getByTestId("sync-option-device"));

    expect(onChange).toHaveBeenCalledWith("device");
  });

  it("marks the cloud option as coming soon and refuses to select it", async () => {
    const onChange = jest.fn();
    const { getByTestId, getByText } = await render(<SyncModeSelector value="device" onChange={onChange} />);

    const cloudCard = getByTestId("sync-option-cloud");
    expect(cloudCard.props.accessibilityState).toMatchObject({ disabled: true, selected: false });
    expect(getByText("Em breve")).toBeTruthy();
    expect(getByText("Ainda estamos preparando essa opção — em breve ela fica disponível.")).toBeTruthy();

    fireEvent.press(cloudCard);

    expect(onChange).not.toHaveBeenCalled();
  });

  it("never shows the cloud option as selected, even when it is the current value", async () => {
    const { getByTestId } = await render(<SyncModeSelector value="cloud" onChange={jest.fn()} />);

    expect(getByTestId("sync-option-cloud").props.accessibilityState).toMatchObject({ selected: false });
  });

  it("reports cloud as not selectable and device as selectable", () => {
    expect(isSyncModeSelectable("cloud")).toBe(false);
    expect(isSyncModeSelectable("device")).toBe(true);
  });
});
