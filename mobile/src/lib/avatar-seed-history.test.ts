import {
  AVATAR_LOOKAHEAD,
  AVATAR_MAX_HISTORY,
  goNext,
  goPrevious,
  initAvatarSeedHistory,
} from "./avatar-seed-history";

function sequentialSeedGenerator(): () => string {
  let n = 0;
  return () => `seed-${n++}`;
}

describe("initAvatarSeedHistory", () => {
  it("starts at index 0 with the given initial seed first", () => {
    const state = initAvatarSeedHistory("initial", sequentialSeedGenerator());

    expect(state.currentIndex).toBe(0);
    expect(state.seeds[0]).toBe("initial");
  });

  it("preloads a full lookahead window up front", () => {
    const state = initAvatarSeedHistory("initial", sequentialSeedGenerator());

    expect(state.seeds).toHaveLength(AVATAR_LOOKAHEAD);
  });
});

describe("goNext", () => {
  it("moves the current index forward by one", () => {
    const state = initAvatarSeedHistory("initial", sequentialSeedGenerator());

    const next = goNext(state, sequentialSeedGenerator());

    expect(next.currentIndex).toBe(1);
  });

  it("generates exactly one new seed to replenish the lookahead window that just slid forward", () => {
    const state = initAvatarSeedHistory("initial", sequentialSeedGenerator());
    const generate = jest.fn(sequentialSeedGenerator());

    const next = goNext(state, generate);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(next.seeds).toHaveLength(AVATAR_LOOKAHEAD + 1);
  });

  it("reuses the already-generated seed instead of generating a new one when moving back into previously-visited territory", () => {
    let state = initAvatarSeedHistory("initial", sequentialSeedGenerator());
    state = goNext(state, sequentialSeedGenerator());
    state = goPrevious(state);
    const generate = jest.fn(sequentialSeedGenerator());

    goNext(state, generate);

    expect(generate).not.toHaveBeenCalled();
  });

  it("caps the history at AVATAR_MAX_HISTORY, dropping the oldest seed and shifting the index down", () => {
    let state = initAvatarSeedHistory("initial", sequentialSeedGenerator());
    const generate = sequentialSeedGenerator();

    for (let i = 0; i < AVATAR_MAX_HISTORY; i++) {
      state = goNext(state, generate);
    }

    expect(state.seeds.length).toBeLessThanOrEqual(AVATAR_MAX_HISTORY);
  });

  it("in steady state (once the cap kicks in), the user can go back exactly AVATAR_MAX_HISTORY - AVATAR_LOOKAHEAD steps", () => {
    let state = initAvatarSeedHistory("initial", sequentialSeedGenerator());
    const generate = sequentialSeedGenerator();

    // Enough forward moves to be well past the point the cap first kicks in.
    for (let i = 0; i < AVATAR_MAX_HISTORY * 2; i++) {
      state = goNext(state, generate);
    }

    const stepsAvailableBack = state.currentIndex;
    expect(stepsAvailableBack).toBe(AVATAR_MAX_HISTORY - AVATAR_LOOKAHEAD);

    for (let i = 0; i < stepsAvailableBack; i++) {
      state = goPrevious(state);
    }
    expect(state.currentIndex).toBe(0);
  });
});

describe("goPrevious", () => {
  it("moves the current index back by one", () => {
    let state = initAvatarSeedHistory("initial", sequentialSeedGenerator());
    state = goNext(state, sequentialSeedGenerator());

    const previous = goPrevious(state);

    expect(previous.currentIndex).toBe(0);
  });

  it("never goes below index 0", () => {
    const state = initAvatarSeedHistory("initial", sequentialSeedGenerator());

    const previous = goPrevious(state);

    expect(previous.currentIndex).toBe(0);
  });

  it("restores the exact same seed the user saw before, not a new one", () => {
    let state = initAvatarSeedHistory("initial", sequentialSeedGenerator());
    state = goNext(state, sequentialSeedGenerator());
    const secondSeed = state.seeds[state.currentIndex];

    state = goPrevious(state);
    state = goNext(state, sequentialSeedGenerator());

    expect(state.seeds[state.currentIndex]).toBe(secondSeed);
  });
});
