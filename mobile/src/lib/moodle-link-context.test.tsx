import { act, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { type JSX } from "react";

import { startMoodleLogin } from "./moodle-auth";
import { getSiteInfo, onMoodleTokenVerdict } from "./moodle-api";
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
  onMoodleTokenVerdict: jest.fn(),
}));

const mockGetSession = getMoodleSession as jest.Mock;
const mockSave = saveMoodleSession as jest.Mock;
const mockClear = clearMoodleSession as jest.Mock;
const mockStart = startMoodleLogin as jest.Mock;
const mockOnVerdict = onMoodleTokenVerdict as jest.Mock;

function Probe(): JSX.Element {
  const link = useMoodleLink();
  return <Text testID="status">{link.status}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  (rememberMoodleWasLinked as jest.Mock).mockResolvedValue(undefined);
  mockOnVerdict.mockReturnValue(jest.fn());
});

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
  void getSiteInfo;
});

it("link() treats a failed local save as not linked", async () => {
  mockGetSession.mockResolvedValueOnce(null);
  mockStart.mockResolvedValueOnce({
    status: "success",
    session: { wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 3 },
  });
  mockSave.mockRejectedValueOnce(new Error("secure store unavailable"));

  let linkFn: () => Promise<{ status: string }> = async () => ({ status: "unlinked" });
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

  let result: { status: string } | undefined;
  await act(async () => {
    result = await linkFn();
  });

  expect(result?.status).toBe("failed");
  expect(rememberMoodleWasLinked).not.toHaveBeenCalled();
  expect(screen.getByTestId("status").props.children).toBe("unlinked");
});

it("unlink() clears the stored session and reports unlinked", async () => {
  mockGetSession.mockResolvedValueOnce({ wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 1 });

  let unlinkFn: () => Promise<void> = async () => undefined;
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    unlinkFn = ctx.unlink;
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = await render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));

  await act(async () => {
    await unlinkFn();
  });

  expect(mockClear).toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlinked"));
});

it("flips expired to true when the token verdict listener reports expired", async () => {
  mockGetSession.mockResolvedValueOnce({ wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 1 });

  let verdictListener: (verdict: "valid" | "expired") => void = () => undefined;
  mockOnVerdict.mockImplementation((listener: (verdict: "valid" | "expired") => void) => {
    verdictListener = listener;
    return jest.fn();
  });

  let latestExpired: boolean | undefined;
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    if (ctx.status === "linked") latestExpired = ctx.expired;
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = await render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));
  expect(latestExpired).toBe(false);

  await act(async () => {
    verdictListener("expired");
  });

  expect(latestExpired).toBe(true);
});
