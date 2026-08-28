// context/AuthContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../firebaseApp";
import { AppUser, buildAppUser, buildSafePendingAppUser } from "./authUser";

type Unsubscribe = () => void;

type AuthCtx = {
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  refreshAppUser: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  appUser: null,
  loading: true,
  refreshAppUser: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAppUser = useCallback(async (u: User) => {
    try {
      const [{ doc, getDocFromServer }, { db }] = await Promise.all([
        import("firebase/firestore"),
        import("../firebase"),
      ]);
      const snap = await getDocFromServer(doc(db, "users", u.uid));
      if (auth.currentUser?.uid !== u.uid) return;

      setAppUser(
        snap.exists()
          ? buildAppUser({ uid: u.uid, email: u.email }, snap.data())
          : buildSafePendingAppUser(
              { uid: u.uid, email: u.email },
              { profileExists: false }
            )
      );
    } catch (error) {
      console.error("Failed to load app user profile:", error);
      if (auth.currentUser?.uid === u.uid) {
        setAppUser(buildSafePendingAppUser({ uid: u.uid, email: u.email }));
      }
    }
  }, []);

  const refreshAppUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await loadAppUser(auth.currentUser);
  }, [loadAppUser]);

  useEffect(() => {
    let profileUnsubscribe: Unsubscribe | null = null;
    let authVersion = 0;
    let hasAuthoritativeProfile = false;

    const authUnsubscribe = onAuthStateChanged(auth, (u) => {
      authVersion += 1;
      const currentVersion = authVersion;
      hasAuthoritativeProfile = false;

      profileUnsubscribe?.();
      profileUnsubscribe = null;
      setUser(u);
      setAppUser(null);

      if (!u) {
        setLoading(false);
        return;
      }

      // A newly authenticated user is not allowed through any protected route
      // until their authoritative profile has resolved.
      setLoading(true);

      void Promise.all([import("firebase/firestore"), import("../firebase")])
        .then(([{ doc, getDocFromServer, onSnapshot }, { db }]) => {
          if (currentVersion !== authVersion || auth.currentUser?.uid !== u.uid) return;

          const profileRef = doc(db, "users", u.uid);
          const applyAuthoritativeProfile = (snap: {
            exists: () => boolean;
            data: () => unknown;
          }) => {
            if (currentVersion !== authVersion || auth.currentUser?.uid !== u.uid) return;

            hasAuthoritativeProfile = true;
            setAppUser(
              snap.exists()
                ? buildAppUser({ uid: u.uid, email: u.email }, snap.data() as any)
                : buildSafePendingAppUser(
                    { uid: u.uid, email: u.email },
                    { profileExists: false }
                  )
            );
            setLoading(false);
          };

          const unsubscribe = onSnapshot(
            profileRef,
            { includeMetadataChanges: true },
            (snap) => {
              if (currentVersion !== authVersion || auth.currentUser?.uid !== u.uid) return;

              // Never elevate from an offline or persisted cache snapshot.
              // Once this session has already been confirmed by the server,
              // though, keep that last authoritative profile while Firestore
              // reconnects. Replacing it with the safe pending profile here
              // would eject a gym TV from /display during a brief Wi-Fi dip.
              // A later server snapshot still applies role/access revocations.
              if (snap.metadata.fromCache) {
                if (!hasAuthoritativeProfile) {
                  setAppUser(buildSafePendingAppUser({ uid: u.uid, email: u.email }));
                }
                return;
              }

              applyAuthoritativeProfile(snap);
            },
            (error) => {
              if (currentVersion !== authVersion || auth.currentUser?.uid !== u.uid) return;

              console.error("Failed to subscribe to app user profile:", error);
              setAppUser(buildSafePendingAppUser({ uid: u.uid, email: u.email }));
              setLoading(false);
            }
          );

          if (currentVersion !== authVersion || auth.currentUser?.uid !== u.uid) {
            unsubscribe();
            return;
          }
          profileUnsubscribe = unsubscribe;

          // The first protected render requires an explicit server read. The
          // listener remains the live revocation path after that confirmation.
          void getDocFromServer(profileRef)
            .then(applyAuthoritativeProfile)
            .catch((error) => {
              if (currentVersion !== authVersion || auth.currentUser?.uid !== u.uid) return;

              console.error("Failed to confirm app user profile with the server:", error);
              // The live listener may have delivered an authoritative server
              // snapshot before this one-off read failed. Do not downgrade a
              // confirmed session in that race (or during a reconnect).
              if (!hasAuthoritativeProfile) {
                setAppUser(buildSafePendingAppUser({ uid: u.uid, email: u.email }));
                setLoading(false);
              }
            });
        })
        .catch((error) => {
          if (currentVersion !== authVersion || auth.currentUser?.uid !== u.uid) return;

          console.error("Failed to initialise app user subscription:", error);
          setAppUser(buildSafePendingAppUser({ uid: u.uid, email: u.email }));
          setLoading(false);
        });
    });

    return () => {
      authVersion += 1;
      profileUnsubscribe?.();
      authUnsubscribe();
    };
  }, []);

  return (
    <Ctx.Provider value={{ user, appUser, loading, refreshAppUser }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
