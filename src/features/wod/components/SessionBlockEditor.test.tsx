import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import SessionBlockEditor from "./SessionBlockEditor";
import { ConditioningBlock, SessionBlock, createBlock } from "../utils/programming";

function conditioningBlock(patch: Partial<ConditioningBlock> = {}): ConditioningBlock {
  return { ...(createBlock("conditioning") as ConditioningBlock), ...patch };
}

function renderBlock(block: SessionBlock) {
  const onChange = jest.fn();

  render(
    <SessionBlockEditor
      block={block}
      index={0}
      total={1}
      onChange={onChange}
      onMove={jest.fn()}
      onDuplicate={jest.fn()}
      onRemove={jest.fn()}
    />
  );

  return { onChange };
}

describe("conditioning number fields", () => {
  it("lets a coach clear Rounds and type a new number", () => {
    const { onChange } = renderBlock(conditioningBlock({ rounds: 1 }));
    const rounds = screen.getByLabelText("Rounds") as HTMLInputElement;

    // On a phone this is the only way to replace the value: delete, then type.
    fireEvent.change(rounds, { target: { value: "" } });

    expect(rounds.value).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(rounds, { target: { value: "4" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rounds: 4 }));
  });

  it("settles on the saved value when the field is left empty", () => {
    const { onChange } = renderBlock(conditioningBlock({ rounds: 3 }));
    const rounds = screen.getByLabelText("Rounds") as HTMLInputElement;

    fireEvent.change(rounds, { target: { value: "" } });
    fireEvent.blur(rounds);

    expect(rounds.value).toBe("3");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps entries inside the field's range", () => {
    const { onChange } = renderBlock(conditioningBlock({ roundSeconds: 0 }));

    fireEvent.change(screen.getByLabelText("Seconds"), { target: { value: "90" } });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ roundSeconds: 59 }));
  });
});
