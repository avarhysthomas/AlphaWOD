import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockOnSnapshot = jest.fn();
const mockGetDoc = jest.fn();

jest.mock("../../../firebase", () => ({ db: {} }));

// react-router-dom v7 is ESM-only and CRA's jest can't resolve it; the board
// only uses <Link>.
jest.mock(
  "react-router-dom",
  () => ({
    Link: ({ children, to, ...rest }: Record<string, unknown> & { children?: unknown }) =>
      require("react").createElement("a", { href: to, ...rest }, children),
  }),
  { virtual: true }
);

// Refs carry enough shape for the tests to tell the board's `wods/{date}`
// listener apart from the attendee rail's classes/bookings listeners. These are
// plain functions, not jest.fn(): CRA sets resetMocks, which would strip the
// implementations before every test.
jest.mock("firebase/firestore", () => ({
  doc: (_db: unknown, path: string, id: string) => ({ kind: "doc", path, id }),
  collection: (_db: unknown, path: string) => ({ kind: "collection", path }),
  query: (ref: { path: string }) => ({ kind: "query", path: ref.path }),
  where: () => ({}),
  Timestamp: { fromDate: (value: Date) => ({ millis: value.getTime() }) },
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
}));

jest.mock("../components/SessionShareModal", () => () => null);

// eslint-disable-next-line import/first
import WODDisplay from "./WODDisplay";
// eslint-disable-next-line import/first
import { getHourInTimeZone } from "../../../utils/date";

beforeAll(() => {
  // jsdom has no ResizeObserver; useFitScale only needs it to exist.
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  mockOnSnapshot.mockReset();
  mockOnSnapshot.mockReturnValue(() => {});
  mockGetDoc.mockReset();
  mockGetDoc.mockResolvedValue({ exists: () => false, data: () => null });
});

const conditioning = {
  id: "b-cond",
  kind: "conditioning",
  title: "Conditioning",
  format: "AMRAP",
  timerMode: "timed",
  roundMinutes: 12,
  roundSeconds: 0,
  rounds: 3,
  restBetweenRoundsSeconds: 60,
  groupSize: 4,
  controlStationIndex: 0,
  stations: [
    { id: "s1", title: "Ski", movements: [{ id: "m1", name: "Ski Erg", target: "250m" }] },
  ],
};

const finisher = {
  id: "b-cond2",
  kind: "conditioning",
  title: "Finisher Intervals",
  format: "Intervals",
  timerMode: "timed",
  roundMinutes: 1,
  roundSeconds: 30,
  rounds: 5,
  restBetweenRoundsSeconds: 30,
  groupSize: 4,
  controlStationIndex: 0,
  stations: [
    { id: "s2", title: "Bike", movements: [{ id: "m2", name: "Assault Bike", target: "15 cal" }] },
  ],
};

const warmup = {
  id: "b-warm",
  kind: "warmup",
  title: "Warm-up",
  text: "500m row\n10 air squats",
};

/**
 * A v2 session with two conditioning blocks. The legacy projection carries the
 * FIRST block's timing only — which is exactly why the board must not read it.
 */
function multiBlockSession() {
  return {
    version: 2,
    wodName: "Engine Builder",
    blocks: [warmup, conditioning, finisher],
    sessionType: "HYROX",
    wodType: "AMRAP",
    timerMode: "timed",
    groupSize: 4,
    roundDurationSeconds: 720,
    rounds: 3,
    restBetweenRoundsSeconds: 60,
    controlStationIndex: 0,
    stations: conditioning.stations,
    movements: ["Ski Erg"],
  };
}

/** Same session in every slot, so the test is independent of the time of day. */
function dayDoc(session: Record<string, unknown>) {
  return { AM: session, "930AM": session, PM: session };
}

/** Newest listener registered against a ref the predicate accepts. */
function latestListener(matches: (ref: any) => boolean) {
  for (let i = mockOnSnapshot.mock.calls.length - 1; i >= 0; i -= 1) {
    const call = mockOnSnapshot.mock.calls[i];
    if (matches(call[0])) return call[1] as (snap: unknown) => void;
  }

  throw new Error("No matching onSnapshot listener was registered.");
}

function emitSnapshot(data: Record<string, unknown> | null) {
  const onNext = latestListener((ref) => ref?.kind === "doc");
  act(() => {
    onNext({ exists: () => data !== null, data: () => data });
  });
}

/**
 * A Date today whose Europe/London clock reads `hour:minute` — slots are keyed
 * off gym time, so a test machine in another zone must not shift them.
 */
function londonTimeToday(hour: number, minute = 0) {
  const probe = new Date();
  probe.setHours(12, 0, 0, 0);
  const shift = 12 - getHourInTimeZone(probe, "Europe/London");

  const start = new Date();
  start.setHours(hour + shift, minute, 0, 0);
  return start;
}

function classAt(id: string, hour: number, minute = 0) {
  const start = londonTimeToday(hour, minute);

  return {
    id,
    data: () => ({ status: "scheduled", startTime: { toDate: () => start } }),
  };
}

/**
 * One class in each slot, so exactly one matches whichever slot the board
 * opened on — the test then does not depend on the time of day.
 */
function emitAllDayClasses() {
  const onNext = latestListener(
    (ref) => ref?.kind === "query" && ref.path === "classes"
  );

  act(() => {
    onNext({
      docs: [classAt("class-am", 6), classAt("class-930", 9, 30), classAt("class-pm", 18)],
    });
  });
}

function emitBookings(rows: Array<{ userId: string; userName: string }>) {
  const onNext = latestListener(
    (ref) => ref?.kind === "query" && ref.path === "bookings"
  );

  act(() => {
    onNext({ docs: rows.map((row) => ({ data: () => ({ ...row, status: "booked" }) })) });
  });
}

function renderBoard() {
  return render(<WODDisplay />);
}

describe("WODDisplay board", () => {
  it("subscribes to the selected day so the TV picks up live edits", () => {
    renderBoard();
    expect(mockOnSnapshot).toHaveBeenCalled();

    emitSnapshot(dayDoc(multiBlockSession()));
    expect(screen.getByText("Engine Builder")).toBeInTheDocument();

    // A later edit reaches the board without a reload.
    const renamed = { ...multiBlockSession(), wodName: "Engine Builder v2" };
    emitSnapshot(dayDoc(renamed));
    expect(screen.getByText("Engine Builder v2")).toBeInTheDocument();
  });

  it("opens on the first conditioning block and shows its own timer", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    expect(screen.getByText("12:00")).toBeInTheDocument();
    expect(screen.getByText("Round 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Ski")).toBeInTheDocument();
  });

  it("gives every conditioning block its own timer, not the legacy projection", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    fireEvent.click(screen.getByRole("button", { name: /Finisher Intervals/ }));

    // 01:30 x 5 comes from the second block; the legacy fields still say 12:00 x 3.
    expect(screen.getByText("01:30")).toBeInTheDocument();
    expect(screen.getByText("Round 1 of 5")).toBeInTheDocument();
    expect(screen.queryByText("12:00")).not.toBeInTheDocument();

    // The station grid follows the hero.
    expect(screen.getByText("Bike")).toBeInTheDocument();
    expect(screen.queryByText("Ski")).not.toBeInTheDocument();
  });

  it("shows text blocks as their own board page", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    fireEvent.click(screen.getByRole("button", { name: /Warm-up/ }));

    expect(screen.getAllByText(/500m row/).length).toBeGreaterThan(0);
    expect(screen.queryByText("12:00")).not.toBeInTheDocument();
  });

  it("renders a legacy single-block session unchanged", () => {
    renderBoard();
    emitSnapshot(
      dayDoc({
        sessionType: "HYROX",
        wodName: "Classic",
        wodType: "AMRAP",
        timerMode: "timed",
        roundDurationSeconds: 600,
        rounds: 2,
        groupSize: 4,
        stations: [
          { id: "s1", title: "Sled", movements: [{ id: "m1", name: "Sled Push", target: "20m" }] },
        ],
      })
    );

    expect(screen.getByText("Classic")).toBeInTheDocument();
    expect(screen.getByText("10:00")).toBeInTheDocument();
    expect(screen.getByText("Sled")).toBeInTheDocument();
    // Single-block sessions get no rail.
    expect(screen.queryByText(/Block 1 \//)).not.toBeInTheDocument();
  });

  it("shows no footer filler on an ordinary conditioning block", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    expect(screen.queryByText(/Stay sharp/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AlphaFIT TV Mode/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Quality reps\. Own the positions\./)).not.toBeInTheDocument();
  });

  it("still surfaces a coach cue when there is one", () => {
    renderBoard();
    emitSnapshot(
      dayDoc({
        version: 2,
        wodName: "Squat Day",
        sessionType: "Strength",
        strengthCue: "Brace hard, full depth.",
        strengthMovements: [{ movement: "Back Squat", percent: "80%", repRange: "5 x 5" }],
        blocks: [
          {
            id: "b-str",
            kind: "strength",
            title: "Strength",
            goal: "Build",
            load: "80%",
            range: "5",
            cue: "Brace hard, full depth.",
            stations: [
              {
                id: "ss1",
                title: "Back Squat",
                movements: [
                  { id: "sm1", movement: "Back Squat", load: "80%", sets: "5", reps: "5" },
                ],
              },
            ],
          },
        ],
      })
    );

    expect(screen.getAllByText(/Brace hard, full depth\./).length).toBeGreaterThan(0);
  });

  it("reports no session when the day has nothing programmed", () => {
    renderBoard();
    emitSnapshot(null);

    expect(screen.getByText("No session found")).toBeInTheDocument();
  });
});

describe("WODDisplay hierarchy", () => {
  it("names the day once, in the date strip", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    // The old board printed the weekday as a headline, a subtitle and a date.
    expect(screen.queryByText(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/))
      .not.toBeInTheDocument();

    const short = new Date().toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    expect(screen.getAllByText(short)).toHaveLength(1);
  });

  it("falls back to the session type, never the weekday, when a WOD is unnamed", () => {
    renderBoard();
    emitSnapshot(dayDoc({ ...multiBlockSession(), wodName: "" }));

    expect(screen.getByText("HYROX Session")).toBeInTheDocument();
  });

  it("prints a station's number once and leads with its movements", () => {
    renderBoard();
    emitSnapshot(
      dayDoc({
        version: 2,
        wodName: "Gate Runner",
        sessionType: "HYROX",
        blocks: [
          {
            ...conditioning,
            stations: [
              {
                id: "s1",
                // A title that only restates the position earns no space.
                title: "Station 1",
                movements: [
                  { id: "m1", name: "Wall Balls", target: "Top gate" },
                  { id: "m2", name: "Ski Erg", target: "250m" },
                ],
              },
            ],
          },
        ],
      })
    );

    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.queryByText("Station 1")).not.toBeInTheDocument();
    expect(screen.getByText("Wall Balls")).toBeInTheDocument();
    expect(screen.getByText("Ski Erg")).toBeInTheDocument();
    expect(screen.getByText("Top gate")).toBeInTheDocument();
  });

  it("keeps a station title when the coach named it something real", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    expect(screen.getByText("Ski")).toBeInTheDocument();
  });

  it("puts every free-text block kind on the board", () => {
    const textBlock = (kind: string, title: string, text: string) => ({
      id: `b-${kind}`,
      kind,
      title,
      text,
    });

    renderBoard();
    emitSnapshot(
      dayDoc({
        version: 2,
        wodName: "Full Session",
        sessionType: "HYROX",
        blocks: [
          conditioning,
          textBlock("warmup", "Warm-up", "3 min easy row\n10 air squats"),
          textBlock("finisher", "Finisher", "100 flutter kicks\n60s plank hold"),
          textBlock("cooldown", "Cooldown", "3 min easy spin\nCouch stretch"),
          textBlock("notes", "Notes", "Scale the pull ups to ring rows."),
        ],
      })
    );

    const cases = [
      ["Warm-up", "3 min easy row"],
      ["Finisher", "100 flutter kicks"],
      ["Cooldown", "3 min easy spin"],
      ["Notes", "Scale the pull ups to ring rows."],
    ];

    cases.forEach(([blockTitle, body]) => {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(blockTitle) }));
      expect(screen.getAllByText(body).length).toBeGreaterThan(0);
    });
  });

  it("reads notes as prose, not as a numbered sequence", () => {
    renderBoard();
    emitSnapshot(
      dayDoc({
        version: 2,
        wodName: "Full Session",
        sessionType: "HYROX",
        blocks: [
          {
            id: "b-notes",
            kind: "notes",
            title: "Notes",
            text: "Scale the pull ups to ring rows.",
          },
        ],
      })
    );

    // A warm-up numbers its steps; a sentence must not pick up an "01".
    expect(screen.queryByText("01")).not.toBeInTheDocument();
    expect(screen.queryByText(/work through it in order/i)).not.toBeInTheDocument();
  });

  it("gives a text block the whole board instead of a live column that repeats its name", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    fireEvent.click(screen.getByRole("button", { name: /Warm-up/ }));

    // The live column only exists for blocks with something live to show.
    expect(screen.queryByRole("region", { name: /warm-up/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/on the board/i)).not.toBeInTheDocument();

    // Board heading and rail chip — the name is not printed a third time.
    expect(screen.getAllByText("Warm-up")).toHaveLength(2);
  });

  it("numbers a warm-up's steps only when there is a sequence to follow", () => {
    renderBoard();
    emitSnapshot(
      dayDoc({
        version: 2,
        wodName: "Full Session",
        sessionType: "HYROX",
        blocks: [{ id: "b-warm", kind: "warmup", title: "Warm-up", text: "500m row" }],
      })
    );

    expect(screen.getByText("500m row")).toBeInTheDocument();
    expect(screen.queryByText("01")).not.toBeInTheDocument();
  });

  it("shows the metadata strip once, with no repeated entries", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    // "Warm-up" is both the block kind and the block title.
    fireEvent.click(screen.getByRole("button", { name: /Warm-up/ }));

    expect(screen.getAllByText("WARM-UP")).toHaveLength(1);
  });
});

describe("WODDisplay attendee rail", () => {
  it("carries the profile photos of everyone booked onto the slot", async () => {
    mockGetDoc.mockImplementation(async (ref: { id: string }) => ({
      exists: () => true,
      data: () =>
        ref.id === "u-ava"
          ? { name: "Ava Thomas", photoURL: "https://cdn.test/ava.jpg" }
          : { name: "Sam Reed", photoURL: "" },
    }));

    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    emitAllDayClasses();
    emitBookings([
      { userId: "u-ava", userName: "Ava T" },
      { userId: "u-sam", userName: "Sam R" },
    ]);

    // Profiles resolve a tick later; names fall back to the booking until then.
    await waitFor(() =>
      expect(screen.getAllByText("Ava").length).toBeGreaterThan(0)
    );

    expect(screen.getByText("2 booked")).toBeInTheDocument();
    expect(
      await screen.findByRole("img", { name: "Ava Thomas" })
    ).toHaveAttribute("src", "https://cdn.test/ava.jpg");
    // No photo on file falls back to initials rather than a broken image.
    expect(screen.getAllByText("SR").length).toBeGreaterThan(0);
  });

  it("stays off the board when nobody is booked", () => {
    renderBoard();
    emitSnapshot(dayDoc(multiBlockSession()));

    emitAllDayClasses();
    emitBookings([]);

    expect(screen.queryByText(/squad/i)).not.toBeInTheDocument();
  });
});
