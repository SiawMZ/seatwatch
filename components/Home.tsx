"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { savedTemplates, type SavedTemplate } from "@/lib/saved-templates";

export function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);

  useEffect(() => {
    // Browser storage only exists after the page has loaded in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplates(savedTemplates());
  }, []);

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

      <section>
        <h2>Templates</h2>
        <Link className="button" href="/new">
          Create a template
        </Link>
        {templates.length > 0 && (
          <ul className="template-list">
            {templates.map((template) => (
              <li key={template.token}>
                <Link href={`/t/${template.token}`}>{template.name}</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
