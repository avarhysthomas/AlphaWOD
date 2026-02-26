// context/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, User, getAuth } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

type AppUser = {
  uid: string;
  email?: string | null;
  name?: string;
  role?: "admin" | "user";
};

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
        const data: any = snap.exists() ? snap.data() : {};
        setAppUser({
          uid: u.uid,
          email: u.email,
          name: data?.name,
          role: data?.role || "user",
        });
      } catch {
        setAppUser({ uid: u.uid, email: u.email, role: "user" });
      } finally {
        setLoading(false);
      }
    });
  }, [auth]);

  return <Ctx.Provider value={{ user, appUser, loading }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);