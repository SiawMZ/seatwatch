"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/backend";
import {
  DOORS,
  generateLayout,
  LIMITS,
  type Door,
  type LayoutConfig,
  type Seat,
  type SectionConfig,
} from "@/lib/layout";
import { rememberTemplate } from "@/lib/saved-templates";
import { SeatMap } from "./SeatMap";

const newSection = (index: number, id: string): SectionConfig => ({
  id,
  name: `Section ${index}`,
  rows: 15,
  cols: 6,
  newLine: false,
});

const clamp = (value: number, max: number) => Math.min(max, Math.max(1, Math.round(value) || 1));

type Props = {
  token?: string;
  initialName?: string;
  initialConfig?: LayoutConfig;
};

export function TemplateEditor({ token, initialName = "Sunday service", initialConfig }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState<LayoutConfig>(
    () =>
      initialConfig ?? {
        sections: [newSection(1, "s1"), newSection(2, "s2"), newSection(3, "s3")],
        doors: ["back-left", "back-right"],
        overrides: {},
      },
  );
  const [saved, setSaved] = useState(Boolean(token));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const preview = useMemo(() => generateLayout(config, true), [config]);
  const seatCount = preview.seats.filter((s) => !s.removed).length;
  const activeCount = preview.seats.filter((s) => !s.removed && !s.inactive).length;
  const tooMany = seatCount > LIMITS.seats;

  const change = (next: Partial<LayoutConfig>) => {
    setConfig((current) => ({ ...current, ...next }));
    setSaved(false);
  };

  const updateSection = (id: string, patch: Partial<SectionConfig>) =>
    change({ sections: config.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  const toggleDoor = (door: Door) =>
    change({
      doors: config.doors.includes(door) ? config.doors.filter((d) => d !== door) : [...config.doors, door],
    });

  // Tapping a seat cycles it: normal, then not in use, then removed (a gap).
  const cycleSeat = (seat: Seat) => {
    const overrides = { ...config.overrides };
    if (seat.removed) delete overrides[seat.id];
    else if (seat.inactive) overrides[seat.id] = "removed";
    else overrides[seat.id] = "inactive";
    change({ overrides });
  };

  const save = async () => {
    const layout = generateLayout(config);
    if (token) {
      const result = await api.updateTemplate(token, name, layout);
      if (!result) throw new Error("This template no longer exists");
      rememberTemplate(token, name);
      setSaved(true);
      return token;
    }
    const { token: created } = await api.createTemplate(name, layout);
    rememberTemplate(created, name);
    return created;
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () =>
    run(async () => {
      const result = await save();
      if (!token) router.replace(`/t/${result}`);
    });

  const handleOpenRoom = () =>
    run(async () => {
      const result = await save();
      const room = await api.createRoom(result);
      if (!room) throw new Error("Could not open a room");
      router.push(`/r/${room.code}`);
    });

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="page editor">
      <header className="page-header">
        <Link href="/" className="brand">
          Seatwatch
        </Link>
        <h1>{token ? "Edit template" : "New template"}</h1>
      </header>

      {token && (
        <section className="notice">
          <div>
            <strong>Keep this page&apos;s link.</strong> It&apos;s the only way back to this template, and anyone
            who has it can edit.
          </div>
          <button type="button" onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </section>
      )}

      <div className="editor-grid">
        <div className="editor-form">
          <label className="field">
            <span>Template name</span>
            <input value={name} maxLength={80} onChange={(e) => { setName(e.target.value); setSaved(false); }} />
          </label>

          <h2>Sections</h2>
          {config.sections.map((section, index) => (
            <fieldset key={section.id} className="section-card">
              <label className="field">
                <span>Name</span>
                <input
                  value={section.name}
                  maxLength={30}
                  onChange={(e) => updateSection(section.id, { name: e.target.value })}
                />
              </label>
              <div className="two-up">
                <label className="field">
                  <span>Rows</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={LIMITS.rows}
                    value={section.rows}
                    onChange={(e) => updateSection(section.id, { rows: clamp(+e.target.value, LIMITS.rows) })}
                  />
                </label>
                <label className="field">
                  <span>Seats per row</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={LIMITS.cols}
                    value={section.cols}
                    onChange={(e) => updateSection(section.id, { cols: clamp(+e.target.value, LIMITS.cols) })}
                  />
                </label>
              </div>
              <div className="section-actions">
                {index > 0 && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={section.newLine}
                      onChange={(e) => updateSection(section.id, { newLine: e.target.checked })}
                    />
                    Place behind the sections before it
                  </label>
                )}
                {config.sections.length > 1 && (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => change({ sections: config.sections.filter((s) => s.id !== section.id) })}
                  >
                    Remove
                  </button>
                )}
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            disabled={config.sections.length >= LIMITS.sections}
            onClick={() =>
              change({
                sections: [
                  ...config.sections,
                  newSection(config.sections.length + 1, crypto.randomUUID().slice(0, 8)),
                ],
              })
            }
          >
            Add section
          </button>

          <h2>Doors</h2>
          <div className="checks">
            {DOORS.map((door) => (
              <label key={door.id} className="check">
                <input
                  type="checkbox"
                  checked={config.doors.includes(door.id)}
                  onChange={() => toggleDoor(door.id)}
                />
                {door.label}
              </label>
            ))}
          </div>
        </div>

        <div className="editor-preview">
          <h2>
            Preview: {activeCount} seats
            {seatCount !== activeCount && ` + ${seatCount - activeCount} not in use`}
          </h2>
          <p className="hint">
            Tap a seat to change it: normal, then not in use, then removed. Gaps between sections are aisles.
          </p>
          <SeatMap
            layout={preview}
            statusFor={(seat) => (seat.inactive ? "not_in_use" : "available")}
            onSeatTap={cycleSeat}
          />
        </div>
      </div>

      {tooMany && <p className="error">A template can have up to {LIMITS.seats} seats.</p>}
      {error && <p className="error">{error}</p>}

      <div className="action-bar">
        <button type="button" onClick={handleSave} disabled={busy || tooMany || !name.trim() || saved}>
          {saved ? "Saved" : "Save template"}
        </button>
        <button
          type="button"
          className="primary"
          onClick={handleOpenRoom}
          disabled={busy || tooMany || !name.trim() || activeCount === 0}
        >
          Save and open room
        </button>
      </div>
    </main>
  );
}
