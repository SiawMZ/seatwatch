"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/backend";
import { recentRooms, timeAgo, type RecentRoom } from "@/lib/recent-rooms";
import { savedTemplates, type SavedTemplate } from "@/lib/saved-templates";
import { useAccount } from "@/lib/use-account";
import { AccountBar } from "./AccountBar";
import { ThemeSwitch } from "./ThemeSwitch";

export function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [onThisPhone, setOnThisPhone] = useState<SavedTemplate[]>([]);
  const [inAccount, setInAccount] = useState<SavedTemplate[]>([]);
  const [rooms, setRooms] = useState<RecentRoom[]>([]);
  const { user, ready } = useAccount();

  useEffect(() => {
    // Browser storage only exists after the page has loaded in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnThisPhone(savedTemplates());
    setRooms(recentRooms());
  }, []);

  useEffect(() => {
    if (!user) return;
    api.myTemplates().then(setInAccount, () => setInAccount([]));
  }, [user]);

  const accountTokens = new Set(inAccount.map((t) => t.token));
  const templates = [
    ...(user ? inAccount : []),
    ...onThisPhone.filter((t) => !user || !accountTokens.has(t.token)),
  ];

  const join = (event: FormEvent) => {
    event.preventDefault();
    const clean = code.trim().toUpperCase();
    if (clean) router.push(`/r/${encodeURIComponent(clean)}`);
  };

  return (
    <main className="page home">
      <h1 className="brand-large">Seatwatch</h1>
      <p className="lede">See which seats are free, together with the other ushers.</p>

      <form onSubmit={join} className="join">
        <label className="field">
          <span>Join a room</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Room code"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={6}
            className="code"
          />
        </label>
        <button type="submit" className="primary" disabled={!code.trim()}>
          Join
        </button>
      </form>

      {rooms.length > 0 && (
        <section>
          <h2>Recent rooms</h2>
          <ul className="template-list">
            {rooms.map((room) => (
              <li key={room.code}>
                <Link href={`/r/${room.code}`} className="recent-room">
                  <span>{room.name}</span>
                  <span className="tag">
                    <span className="code">{room.code}</span> · {timeAgo(room.visitedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2>Templates</h2>
        <Link className="button" href="/new">
          Create a template
        </Link>
        {templates.length > 0 && (
          <ul className="template-list">
            {templates.map((template) => (
              <li key={template.token}>
                <Link href={`/t/${template.token}`}>
                  {template.name}
                  {user && !accountTokens.has(template.token) && <span className="tag">This phone only</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AccountBar
        user={user}
        ready={ready}
        signedOutText="Signing in is optional. It keeps your templates in your account, so a lost link doesn't lose a template."
      />

      <footer className="home-footer">
        <ThemeSwitch />
      </footer>
    </main>
  );
}
