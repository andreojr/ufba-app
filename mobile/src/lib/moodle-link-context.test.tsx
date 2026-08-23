import { act, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { startMoodleLogin } from "./moodle-auth";
import { getSiteInfo } from "./moodle-api";
import { MoodleLinkProvider, useMoodleLink } from "./moodle-link-context";
import {
  clearMoodleSession,
  getMoodleSession,
  rememberMoodleWasLinked,
  saveMoodleSession,
} from "./moodle-storage";

jest.mock("./moodle-storage");
jest.mock("./moodle-auth");
jest.mock("./moodle-api", () => ({
  ...jest.requireActual("./moodle-api"),
  getSiteInfo: jest.fn(),
}));

const mockGetSession = getMoodleSession as jest.Mock;
const mockSave = saveMoodleSession as jest.Mock;
const mockStart = startMoodleLogin as jest.Mock;

function Probe(): JSX.Element {
  const link = useMoodleLink();
  return <Text testID="status">{link.status}</Text>;
}

beforeEach(() => jest.clearAllMocks());

it("hydrates to unlinked when there is no stored session", async () => {
  mockGetSession.mockResolvedValueOnce(null);
  const screen = await render(
    <MoodleLinkProvider>
      <Probe />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlinked"));
});

it("hydrates to linked when a session is stored", async () => {
  mockGetSession.mockResolvedValueOnce({ wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 1 });
  const screen = await render(
    <MoodleLinkProvider>
      <Probe />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));
});

it("link() saves the session on success", async () => {
  mockGetSession.mockResolvedValueOnce(null);
  mockStart.mockResolvedValueOnce({
    status: "success",
    session: { wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 3 },
  });

  let linkFn: () => Promise<unknown> = async () => undefined;
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    linkFn = ctx.link;
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = await render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlinked"));

  await act(async () => {
    await linkFn();
  });

  expect(mockSave).toHaveBeenCalledWith({ wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 3 });
  expect(rememberMoodleWasLinked).toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));
  void clearMoodleSession;
  void getSiteInfo;
});
