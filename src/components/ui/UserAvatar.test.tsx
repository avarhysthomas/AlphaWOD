import { fireEvent, render, screen } from "@testing-library/react";
import UserAvatar from "./UserAvatar";

describe("UserAvatar", () => {
  it("replaces a broken profile photo with the member's initials", () => {
    render(
      <UserAvatar
        name="Ada Lovelace"
        photoURL="https://cdn.example.com/missing-profile.jpg"
      />
    );

    fireEvent.error(screen.getByRole("img", { name: "Ada Lovelace's profile picture" }));

    expect(screen.getByRole("img", { name: "Ada Lovelace's profile picture" })).toHaveTextContent("AL");
    expect(screen.queryByAltText("Ada Lovelace's profile picture")).not.toBeInTheDocument();
  });

  it("tries a new profile photo after an earlier URL fails", () => {
    const { rerender } = render(
      <UserAvatar name="Ada Lovelace" photoURL="https://cdn.example.com/old.jpg" />
    );

    fireEvent.error(screen.getByAltText("Ada Lovelace's profile picture"));
    rerender(
      <UserAvatar name="Ada Lovelace" photoURL="https://cdn.example.com/new.jpg" />
    );

    expect(screen.getByAltText("Ada Lovelace's profile picture")).toHaveAttribute(
      "src",
      "https://cdn.example.com/new.jpg"
    );
  });

  it("uses a fallback for an empty profile photo URL", () => {
    render(<UserAvatar name="Sam Reed" photoURL="   " />);

    expect(screen.getByRole("img", { name: "Sam Reed's profile picture" })).toHaveTextContent("SR");
    expect(screen.queryByAltText("Sam Reed's profile picture")).not.toBeInTheDocument();
  });
});
