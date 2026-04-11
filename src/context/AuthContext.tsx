// context/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User, getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";
import { AppUser, buildAppUser, buildSafePendingAppUser } from "./authUser";

type AuthCtx = {
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
};

const Ctx = createContext<AuthCtx>({ user: null, appUser: null, loading: true });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const auth = getAuth();
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);

      if (!u) {
        setAppUser(null);
        setLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        const data = snap.exists() ? snap.data() : {};
        setAppUser(buildAppUser({ uid: u.uid, email: u.email }, data));
      } catch (error) {
        console.error("Failed to load app user profile:", error);
        setAppUser(buildSafePendingAppUser({ uid: u.uid, email: u.email }));
      } finally {
        setLoading(false);
      }
    });
  }, [auth]);

  return <Ctx.Provider value={{ user, appUser, loading }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
