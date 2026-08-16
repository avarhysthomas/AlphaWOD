import {
  addDays,
  buildSessionPayload,
  cleanSessionPlan,
  clonePlan,
  createBlock,
  describeSlotPayload,
  mondayOf,
  normalizeSessionPlan,
  sessionPlanIsEmpty,
  sessionShareItems,
  sessionTotalSeconds,
  slotForHour,
  weekDays,
  ConditioningBlock,
  SessionPlan,
  StrengthBlock,
  TextBlock,
} from "./programming";

function conditioningBlock(overrides: Partial<ConditioningBlock> = {}): ConditioningBlock {
  const block = createBlock("conditioning") as ConditioningBlock;
  block.stations[0].movements[0].name = "Ski Erg";
  block.stations[0].movements[0].target = "15 cals";
  return { ...block, ...overrides };
}

function strengthBlock(overrides: Partial<StrengthBlock> = {}): StrengthBlock {
  const block = createBlock("strength") as StrengthBlock;
  const movement = block.stations[0].movements[0];
  movement.movement = "Back Squat";
  movement.load = "75%";
  movement.sets = "5";
  movement.reps = "5";
  return { ...block, ...overrides };
}

describe("normalizeSessionPlan", () => {
  it("converts a legacy HYROX payload into a conditioning block", () => {
    const plan = normalizeSessionPlan({
      wodName: "Engine Day",
      sessionType: "HYROX",
      wodType: "EMOM",
      timerMode: "timed",
      roundDurationSeconds: 90,
      rounds: 10,
      restBetweenRoundsSeconds: 30,
      groupSize: 6,
      controlStationIndex: 1,
      stations: [
        { id: "s1", title: "Sleds", movements: [{ id: "m1", name: "Sled Push", target: "20m" }] },
        { id: "s2", title: "Erg", movements: [{ id: "m2", name: "Row", target: "15 cals" }] },
      ],
    });

    expect(plan.wodName).toBe("Engine Day");
    expect(plan.blocks).toHaveLength(1);
    const block = plan.blocks[0] as ConditioningBlock;
    expect(block.kind).toBe("conditioning");
    expect(block.format).toBe("EMOM");
    expect(block.roundMinutes).toBe(1);
    expect(block.roundSeconds).toBe(30);
    expect(block.rounds).toBe(10);
    expect(block.groupSize).toBe(6);
    expect(block.controlStationIndex).toBe(1);
    expect(block.stations).toHaveLength(2);
    expect(block.stations[0].movements[0].name).toBe("Sled Push");
  });

  it("converts a legacy Strength payload into one station per old row", () => {
    const plan = normalizeSessionPlan({
      wodName: "Lower",
      sessionType: "Strength",
      strengthMovements: [
        { movement: "Deadlift", percent: "80%", repRange: "4x4" },
        { movement: "Front Squat", percent: "70%", repRange: "3x8" },
      ],
      strengthGoal: "Heavy",
      strengthLoad: "% of 1RM",
      strengthRange: "4x4",
      strengthCue: "Brace hard",
    });

    expect(plan.blocks).toHaveLength(1);
    const block = plan.blocks[0] as StrengthBlock;
    expect(block.kind).toBe("strength");
    expect(block.stations).toHaveLength(2);
    expect(block.stations[0].movements[0].movement).toBe("Deadlift");
    expect(block.stations[0].movements[0].load).toBe("80%");
    expect(block.stations[0].movements[0].reps).toBe("4x4");
    expect(block.goal).toBe("Heavy");
    expect(block.cue).toBe("Brace hard");
  });

  it("converts interim v2 strength rows into stations", () => {
    const plan = normalizeSessionPlan({
      wodName: "Lower",
      blocks: [
        {
          id: "b1",
          kind: "strength",
          title: "Strength",
          goal: "",
          load: "",
          range: "",
          cue: "",
          rows: [{ id: "r1", movement: "Bench Press", percent: "70%", repRange: "5x5" }],
        },
      ],
    });

    const block = plan.blocks[0] as StrengthBlock;
    expect(block.stations).toHaveLength(1);
    expect(block.stations[0].movements[0].movement).toBe("Bench Press");
    expect(block.stations[0].movements[0].load).toBe("70%");
  });

  it("converts legacy string movements into a single station", () => {
    const plan = normalizeSessionPlan({
      sessionType: "HYROX",
      movements: ["Burpees", "Wall Balls"],
    });

    const block = plan.blocks[0] as ConditioningBlock;
    expect(block.stations).toHaveLength(1);
    expect(block.stations[0].movements.map((m) => m.name)).toEqual(["Burpees", "Wall Balls"]);
  });

  it("prefers v2 blocks when present", () => {
    const original: SessionPlan = {
      wodName: "Hybrid",
      blocks: [strengthBlock(), conditioningBlock()],
    };
    const payload = buildSessionPayload(original);
    const plan = normalizeSessionPlan(payload);

    expect(plan.blocks.map((b) => b.kind)).toEqual(["strength", "conditioning"]);
  });

  it("returns an empty plan for null/undefined", () => {
    expect(normalizeSessionPlan(null).blocks).toHaveLength(0);
    expect(normalizeSessionPlan(undefined).blocks).toHaveLength(0);
  });
});

describe("buildSessionPayload", () => {
  it("projects a conditioning block onto the legacy HYROX fields", () => {
    const plan: SessionPlan = {
      wodName: "Engine",
      blocks: [
        conditioningBlock({
          format: "For Time",
          roundMinutes: 10,
          roundSeconds: 0,
          rounds: 3,
          restBetweenRoundsSeconds: 60,
          groupSize: 5,
        }),
      ],
    };

    const payload = buildSessionPayload(plan) as any;

    expect(payload.sessionType).toBe("HYROX");
    expect(payload.wodType).toBe("For Time");
    expect(payload.roundDurationSeconds).toBe(600);
    expect(payload.rounds).toBe(3);
    expect(payload.totalWorkSeconds).toBe(1800);
    expect(payload.totalSessionSeconds).toBe(1800 + 120);
    expect(payload.groupSize).toBe(5);
    expect(payload.stations).toHaveLength(1);
    expect(payload.movements).toEqual(["Ski Erg"]);
    expect(payload.version).toBe(2);
    expect(Array.isArray(payload.blocks)).toBe(true);
  });

  it("projects a strength-only plan onto the legacy Strength fields", () => {
    const plan: SessionPlan = {
      wodName: "Lower",
      blocks: [strengthBlock({ goal: "Heavy", cue: "Brace" })],
    };

    const payload = buildSessionPayload(plan) as any;

    expect(payload.sessionType).toBe("Strength");
    expect(payload.strengthMovements).toEqual([
      { movement: "Back Squat", percent: "75%", repRange: "5 x 5" },
    ]);
    expect(payload.strengthGoal).toBe("Heavy");
    expect(payload.strengthCue).toBe("Brace");
  });

  it("flattens multi-movement stations into legacy rows", () => {
    const block = strengthBlock();
    block.stations[0].title = "Squat + Pull";
    block.stations[0].movements.push({
      id: "m2",
      movement: "Weighted Pull-up",
      load: "+10kg",
      sets: "4",
      reps: "6",
    });

    const payload = buildSessionPayload({ wodName: "Lower", blocks: [block] }) as any;

    expect(payload.strengthMovements).toEqual([
      { movement: "Back Squat", percent: "75%", repRange: "5 x 5" },
      { movement: "Weighted Pull-up", percent: "+10kg", repRange: "4 x 6" },
    ]);

    const roundTrip = normalizeSessionPlan(payload);
    const rtBlock = roundTrip.blocks[0] as StrengthBlock;
    expect(rtBlock.stations).toHaveLength(1);
    expect(rtBlock.stations[0].title).toBe("Squat + Pull");
    expect(rtBlock.stations[0].movements).toHaveLength(2);
  });

  it("keeps strength data on hybrid sessions while displaying as HYROX", () => {
    const plan: SessionPlan = {
      wodName: "Hybrid",
      blocks: [strengthBlock(), conditioningBlock()],
    };

    const payload = buildSessionPayload(plan) as any;

    expect(payload.sessionType).toBe("HYROX");
    expect(payload.strengthMovements).toHaveLength(1);
    expect(payload.stations).toHaveLength(1);
  });

  it("never emits undefined values (Firestore rejects them)", () => {
    const plan: SessionPlan = {
      wodName: "Check",
      blocks: [strengthBlock(), conditioningBlock(), createBlock("warmup") as TextBlock],
    };
    (plan.blocks[2] as TextBlock).text = "3 min easy row";

    const payload = buildSessionPayload(plan);
    const json = JSON.stringify(payload, (_key, value) => {
      expect(value).not.toBeUndefined();
      return value instanceof Date ? value.toISOString() : value;
    });
    expect(json).toBeTruthy();
  });
});

describe("cleanSessionPlan", () => {
  it("drops empty blocks, rows, and stations", () => {
    const emptyStrength = createBlock("strength") as StrengthBlock;
    const emptyConditioning = createBlock("conditioning") as ConditioningBlock;
    const emptyText = createBlock("warmup") as TextBlock;

    const plan = cleanSessionPlan({
      wodName: "  Trim me  ",
      blocks: [emptyStrength, emptyConditioning, emptyText, strengthBlock()],
    });

    expect(plan.wodName).toBe("Trim me");
    expect(plan.blocks).toHaveLength(1);
    expect(plan.blocks[0].kind).toBe("strength");
  });

  it("clamps the control station index to the cleaned station list", () => {
    const block = conditioningBlock({ controlStationIndex: 5 });
    const plan = cleanSessionPlan({ wodName: "", blocks: [block] });
    expect((plan.blocks[0] as ConditioningBlock).controlStationIndex).toBe(0);
  });
});

describe("sessionPlanIsEmpty / totals / summaries", () => {
  it("detects empty plans", () => {
    expect(sessionPlanIsEmpty({ wodName: "", blocks: [] })).toBe(true);
    expect(sessionPlanIsEmpty({ wodName: "", blocks: [createBlock("notes") as TextBlock] })).toBe(true);
    expect(sessionPlanIsEmpty({ wodName: "Named", blocks: [] })).toBe(false);
    expect(sessionPlanIsEmpty({ wodName: "", blocks: [conditioningBlock()] })).toBe(false);
  });

  it("sums timed conditioning blocks only", () => {
    const timed = conditioningBlock({ roundMinutes: 10, rounds: 2, restBetweenRoundsSeconds: 60 });
    const controlled = conditioningBlock({ timerMode: "stationControlled" });
    expect(sessionTotalSeconds({ wodName: "", blocks: [timed, controlled] })).toBe(1260);
  });

  it("flattens blocks into share lines", () => {
    const warmup = createBlock("warmup") as TextBlock;
    warmup.text = "3 min row\n10 air squats";

    const items = sessionShareItems({
      wodName: "Hybrid",
      blocks: [warmup, strengthBlock(), conditioningBlock()],
    });

    expect(items).toEqual([
      "Warm-up • 3 min row / 10 air squats",
      "Back Squat • 75% • 5 x 5",
      "Station 1 • Ski Erg: 15 cals",
    ]);
  });

  it("groups multi-movement strength stations into one share line", () => {
    const block = strengthBlock();
    block.stations[0].title = "Squat + Pull";
    block.stations[0].movements.push({
      id: "m2",
      movement: "Weighted Pull-up",
      load: "+10kg",
      sets: "4",
      reps: "6",
    });

    const items = sessionShareItems({ wodName: "", blocks: [block] });

    expect(items).toEqual([
      "Squat + Pull • Back Squat: 75% · 5 x 5 • Weighted Pull-up: +10kg · 4 x 6",
    ]);
  });

  it("describes slot payloads for the week planner", () => {
    const payload = buildSessionPayload({ wodName: "Engine", blocks: [conditioningBlock()] });
    const summary = describeSlotPayload(payload);
    expect(summary?.title).toBe("Engine");
    expect(summary?.detail).toContain("AMRAP");

    expect(describeSlotPayload(null)).toBeNull();
    expect(describeSlotPayload({})).toBeNull();
  });
});

describe("clonePlan", () => {
  it("copies content but regenerates every id", () => {
    const source: SessionPlan = {
      wodName: "Engine",
      blocks: [strengthBlock(), conditioningBlock()],
    };

    const copy = clonePlan(source);

    expect(copy.wodName).toBe("Engine");
    expect(copy.blocks).toHaveLength(2);

    const sourceIds: string[] = JSON.stringify(source).match(/"id":"[^"]+"/g) ?? [];
    const copyIds: string[] = JSON.stringify(copy).match(/"id":"[^"]+"/g) ?? [];
    expect(copyIds).toHaveLength(sourceIds.length);
    expect(copyIds.some((id) => sourceIds.includes(id))).toBe(false);

    // Editing the copy must not reach back into the original.
    const copiedStrength = copy.blocks[0] as StrengthBlock;
    copiedStrength.stations[0].movements[0].movement = "Front Squat";
    expect((source.blocks[0] as StrengthBlock).stations[0].movements[0].movement).toBe(
      "Back Squat"
    );
  });
});

describe("week/date helpers", () => {
  it("adds days across month boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("finds Monday for any day of the week", () => {
    expect(mondayOf("2026-07-13")).toBe("2026-07-13"); // Monday
    expect(mondayOf("2026-07-16")).toBe("2026-07-13"); // Thursday
    expect(mondayOf("2026-07-19")).toBe("2026-07-13"); // Sunday
  });

  it("builds a 7-day week", () => {
    const days = weekDays("2026-07-13");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-07-13");
    expect(days[6]).toBe("2026-07-19");
  });
});

describe("slotForHour", () => {
  it("opens on the class that is next", () => {
    expect(slotForHour(0)).toBe("AM");
    expect(slotForHour(6)).toBe("AM");
    expect(slotForHour(7)).toBe("AM");
    expect(slotForHour(8)).toBe("930AM");
    expect(slotForHour(9)).toBe("930AM");
    expect(slotForHour(13)).toBe("930AM");
    expect(slotForHour(14)).toBe("PM");
    expect(slotForHour(18)).toBe("PM");
    expect(slotForHour(23)).toBe("PM");
  });
});
