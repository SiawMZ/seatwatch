"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { account, accountsAvailable } from "./backend";

export function useAccount() {
  const [user, setUser] = useState<User | null>(null);
  // Without accounts there is nothing to wait for.
  const [ready, setReady] = useState(!accountsAvailable);

  useEffect(() => {
    if (!accountsAvailable) return;
    return account.watch((next) => {
      setUser(next);
      setReady(true);
    });
  }, []);

  return { user, ready };
}
