import { act, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Text } from "react-native";
import { useEffect, type JSX } from "react";

import { onMoodleTokenVerdict } from "./moodle-api";
import { MoodleLinkProvider, useMoodleLink } from "./moodle-link-context";
import {
  clearMoodleSession,
  getMoodleSession,
  rememberMoodleWasLinked,
  saveMoodleSession,
  type MoodleSession,
} from "./moodle-storage";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("./moodle-storage");
jest.mock("./moodle-api", () => ({
  ...jest.requireActual("./moodle-api"),
  onMoodleTokenVerdict: jest.fn(),
}));

const mockGetSession = getMoodleSession as jest.Mock;
const mockSave = saveMoodleSession as jest.Mock;
const mockClear = clearMoodleSession as jest.Mock;
const mockPush = router.push as jest.Mock;
const mockOnVerdict = onMoodleTokenVerdict as jest.Mock;

const SESSION: MoodleSession = { wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 3 };

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

it("link() opens the in-app SSO WebView screen (no state change, no persistence yet)", async () => {
  mockGetSession.mockResolvedValueOnce(null);

  // A captura acontece em efeito, não no corpo do componente: escrever para
  // fora durante o render é impuro, e é o que a regra pega — em variável solta
  // ou em propriedade de objeto, tanto faz. Efeito é onde efeito colateral pode.
  const capturado: { link?: () => void } = {};
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    useEffect(() => {
      capturado.link = ctx.link;
    });
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = await render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlinked"));

  // link() only navigates (router.push) — it triggers no React state update,
  // so it is called directly rather than wrapped in act().
  capturado.link?.();

  expect(mockPush).toHaveBeenCalledWith("/moodle-webview");
  expect(mockSave).not.toHaveBeenCalled();
  expect(screen.getByTestId("status").props.children).toBe("unlinked");
});

it("finishLink() persists the session and flips to linked", async () => {
  mockGetSession.mockResolvedValueOnce(null);

  // A captura acontece em efeito, não no corpo do componente: escrever para
  // fora durante o render é impuro, e é o que a regra pega — em variável solta
  // ou em propriedade de objeto, tanto faz. Efeito é onde efeito colateral pode.
  const capturado: { finish?: (s: MoodleSession) => Promise<void> } = {};
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    useEffect(() => {
      capturado.finish = ctx.finishLink;
    });
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = await render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlinked"));

  await act(async () => {
    await capturado.finish?.(SESSION);
  });

  expect(mockSave).toHaveBeenCalledWith(SESSION);
  expect(rememberMoodleWasLinked).toHaveBeenCalled();
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));
});

it("finishLink() throws and stays unlinked when the local save fails", async () => {
  mockGetSession.mockResolvedValueOnce(null);
  mockSave.mockRejectedValueOnce(new Error("secure store unavailable"));

  // A captura acontece em efeito, não no corpo do componente: escrever para
  // fora durante o render é impuro, e é o que a regra pega — em variável solta
  // ou em propriedade de objeto, tanto faz. Efeito é onde efeito colateral pode.
  const capturado: { finish?: (s: MoodleSession) => Promise<void> } = {};
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    useEffect(() => {
      capturado.finish = ctx.finishLink;
    });
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = await render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("unlinked"));

  let threw = false;
  await act(async () => {
    await capturado.finish?.(SESSION).catch(() => {
      threw = true;
    });
  });

  expect(threw).toBe(true);
  expect(rememberMoodleWasLinked).not.toHaveBeenCalled();
  expect(screen.getByTestId("status").props.children).toBe("unlinked");
});

it("unlink() clears the stored session and reports unlinked", async () => {
  mockGetSession.mockResolvedValueOnce({ wstoken: "t", siteUrl: "https://ava.ufba.br", userId: 1 });

  // A captura acontece em efeito, não no corpo do componente: escrever para
  // fora durante o render é impuro, e é o que a regra pega — em variável solta
  // ou em propriedade de objeto, tanto faz. Efeito é onde efeito colateral pode.
  const capturado: { unlink?: () => Promise<void> } = {};
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    useEffect(() => {
      capturado.unlink = ctx.unlink;
    });
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = await render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));

  await act(async () => {
    await capturado.unlink?.();
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

  // A captura acontece em efeito, não no corpo do componente: escrever para
  // fora durante o render é impuro, e é o que a regra pega — em variável solta
  // ou em propriedade de objeto, tanto faz. Efeito é onde efeito colateral pode.
  const capturado: { expired?: boolean } = {};
  function Capture(): JSX.Element {
    const ctx = useMoodleLink();
    useEffect(() => {
      if (ctx.status === "linked") capturado.expired = ctx.expired;
    });
    return <Text testID="status">{ctx.status}</Text>;
  }
  const screen = await render(
    <MoodleLinkProvider>
      <Capture />
    </MoodleLinkProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("status").props.children).toBe("linked"));
  expect(capturado.expired).toBe(false);

  await act(async () => {
    verdictListener("expired");
  });

  expect(capturado.expired).toBe(true);
});
