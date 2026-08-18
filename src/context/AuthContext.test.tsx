import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { AuthProvider, useAuth } from "./AuthContext";

const authStateCallbacks: Array<(user: User | null) => void> = [];
const profileSubscriptions: Array<{
  next: (snapshot: any) => void;
  error: (error: Error) => void;
  unsubscribe: jest.Mock;
}> = [];

jest.mock("firebase/auth", () => ({
  onAuthStateChanged: jest.fn(),
}));

jest.mock("firebase/firestore", () => ({
  doc: jest.fn((_db, collectionName, uid) => `${collectionName}/${uid}`),
  getDocFromServer: jest.fn(),
  onSnapshot: jest.fn(),
}));

jest.mock("../firebaseApp", () => ({
  auth: { currentUser: null },
}));

jest.mock("../firebase", () => ({
  db: {},
}));

const mockAuth = jest.requireMock("../firebaseApp").auth as {
  currentUser: User | null;
};
const mockedOnAuthStateChanged = jest.requireMock("firebase/auth")
  .onAuthStateChanged as jest.Mock;
const mockedOnSnapshot = jest.requireMock("firebase/firestore").onSnapshot as jest.Mock;
const mockedGetDocFromServer = jest.requireMock("firebase/firestore")
  .getDocFromServer as jest.Mock;

function Probe() {
  const { user, appUser, loading } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="uid">{user?.uid ?? "none"}</span>
      <span data-testid="approval">{appUser?.approvalStatus ?? "none"}</span>
      <span data-testid="role">{appUser?.role ?? "none"}</span>
    </div>
  );
}

function makeUser(uid: string): User {
  return { uid, email: `${uid}@example.com` } as User;
}

describe("AuthProvider", () => {
  beforeEach(() => {
    authStateCallbacks.length = 0;
    profileSubscriptions.length = 0;
    mockAuth.currentUser = null;
    mockedOnAuthStateChanged.mockImplementation((_auth, callback) => {
      authStateCallbacks.push(callback);
      return jest.fn();
    });
    mockedGetDocFromServer.mockReturnValue(new Promise(() => {}));
    mockedOnSnapshot.mockImplementation((_ref, _options, next, error) => {
      const subscription = { next, error, unsubscribe: jest.fn() };
      profileSubscriptions.push(subscription);
      return subscription.unsubscribe;
    });
  });

  it("keeps a newly signed-in user loading until the profile resolves", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    const user = makeUser("member-a");
    act(() => {
      mockAuth.currentUser = user;
      authStateCallbacks[0](user);
    });

    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(screen.getByTestId("uid")).toHaveTextContent("member-a");
    expect(screen.getByTestId("approval")).toHaveTextContent("none");

    await waitFor(() => expect(profileSubscriptions).toHaveLength(1));

    act(() => {
      profileSubscriptions[0].next({
        exists: () => false,
        metadata: { fromCache: false },
      });
    });

    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("approval")).toHaveTextContent("pending");
    expect(screen.getByTestId("role")).toHaveTextContent("user");
  });

  it("ignores a stale profile callback after the authenticated user changes", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    const firstUser = makeUser("member-a");
    const secondUser = makeUser("member-b");

    act(() => {
      mockAuth.currentUser = firstUser;
      authStateCallbacks[0](firstUser);
    });
    await waitFor(() => expect(profileSubscriptions).toHaveLength(1));
    act(() => {
      mockAuth.currentUser = secondUser;
      authStateCallbacks[0](secondUser);
    });
    await waitFor(() => expect(profileSubscriptions).toHaveLength(2));

    expect(profileSubscriptions[0].unsubscribe).toHaveBeenCalledTimes(1);

    act(() => {
      profileSubscriptions[0].next({
        exists: () => true,
        data: () => ({ role: "admin", approvalStatus: "approved" }),
        metadata: { fromCache: false },
      });
    });

    expect(screen.getByTestId("uid")).toHaveTextContent("member-b");
    expect(screen.getByTestId("approval")).toHaveTextContent("none");

    act(() => {
      profileSubscriptions[1].next({
        exists: () => true,
        data: () => ({ role: "user", approvalStatus: "pending" }),
        metadata: { fromCache: false },
      });
    });

    expect(screen.getByTestId("approval")).toHaveTextContent("pending");
    expect(screen.getByTestId("role")).toHaveTextContent("user");
  });

  it("never grants from a cached active profile before server confirmation", async () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    const user = makeUser("member-a");
    act(() => {
      mockAuth.currentUser = user;
      authStateCallbacks[0](user);
    });
    await waitFor(() => expect(profileSubscriptions).toHaveLength(1));

    act(() => {
      profileSubscriptions[0].next({
        exists: () => true,
        data: () => ({
          role: "user",
          approvalStatus: "approved",
          entitlementStatus: "active",
          entitlementSource: "stripe",
          alphaWodAccess: true,
        }),
        metadata: { fromCache: true },
      });
    });

    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(screen.getByTestId("approval")).toHaveTextContent("pending");

    act(() => {
      profileSubscriptions[0].next({
        exists: () => true,
        data: () => ({
          role: "user",
          approvalStatus: "approved",
          entitlementStatus: "restricted",
          entitlementSource: "manual",
          alphaWodAccess: false,
        }),
        metadata: { fromCache: false },
      });
    });

    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("approval")).toHaveTextContent("approved");
    expect(screen.getByTestId("role")).toHaveTextContent("user");
  });
});
