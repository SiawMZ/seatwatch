"use client";

import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { account, accountsAvailable } from "@/lib/backend";

type Props = { user: User | null; ready: boolean; signedOutText: string };

export function AccountBar({ user, ready, signedOutText }: Props) {
  const [error, setError] = useState("");
  if (!accountsAvailable || !ready) return null;

  const signIn = async () => {
    setError("");
    const { error } = await account.signInWithGoogle();
    if (error) setError(error.message);
  };

  if (!user) {
    return (
      <section className="account">
        <p>{signedOutText}</p>
        <button type="button" onClick={signIn}>
          Continue with Google
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    );
  }

  return (
    <section className="account signed-in">
      <p>
        Signed in as <strong>{user.email}</strong>
      </p>
      <button type="button" className="link-button" onClick={() => account.signOut()}>
        Sign out
      </button>
    </section>
  );
}
