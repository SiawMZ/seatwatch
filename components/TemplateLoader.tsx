"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type TemplateData } from "@/lib/backend";
import { useAccount } from "@/lib/use-account";
import { TemplateEditor } from "./TemplateEditor";

export function TemplateLoader({ token }: { token: string }) {
  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [missing, setMissing] = useState(false);
  const { user, ready } = useAccount();
  const userId = user?.id;

  // Read again after signing in or out, since whether it's "yours" depends on who is signed in.
  useEffect(() => {
    if (!ready) return;
    api
      .getTemplate(token)
      .then((data) => (data ? setTemplate(data) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [token, ready, userId]);

  if (missing) {
    return (
      <main className="page centered">
        <h1>Template not found</h1>
        <p className="hint">Check that the link is complete.</p>
        <Link className="button primary" href="/">
          Back to start
        </Link>
      </main>
    );
  }
  if (!template) {
    return (
      <main className="page centered">
        <p className="hint">Opening template…</p>
      </main>
    );
  }

  const { sections, doors, overrides } = template.layout;
  return (
    <TemplateEditor
      token={token}
      initialName={template.name}
      initialConfig={{ sections, doors, overrides }}
      owned={template.owned}
      ownedByOther={template.ownedByOther}
    />
  );
}
