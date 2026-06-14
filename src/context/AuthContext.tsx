// context/AuthContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "../firebaseApp";
import { AppUser, buildAppUser, buildSafePendingAppUser } from "./authUser";

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
      const [{ doc, getDoc }, { db }] = await Promise.all([
        import("firebase/firestore"),
        import("../firebase"),
      ]);
      const snap = await getDoc(doc(db, "users", u.uid));
      const data = snap.exists() ? snap.data() : {};
      setAppUser(buildAppUser({ uid: u.uid, email: u.email }, data));
    } catch (error) {
      console.error("Failed to load app user profile:", error);
      setAppUser(buildSafePendingAppUser({ uid: u.uid, email: u.email }));
    }
  }, []);

  const refreshAppUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await loadAppUser(auth.currentUser);
  }, [loadAppUser]);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (!u) {
        setAppUser(null);
        setLoading(false);
        return;
      }

      try {
        await loadAppUser(u);
      } catch (error) {
        console.error("Failed to load app user profile:", error);
        setAppUser(buildSafePendingAppUser({ uid: u.uid, email: u.email }));
      } finally {
        setLoading(false);
      }
    });
  }, [loadAppUser]);

  return (
    <Ctx.Provider value={{ user, appUser, loading, refreshAppUser }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
