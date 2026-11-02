"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { accountsAvailable, api } from "@/lib/backend";
import {
  autoArrange,
  DOORS,
  generateLayout,
  kindOf,
  LIMITS,
  sectionSize,
  type Door,
  type LayoutConfig,
  type Seat,
  type SectionConfig,
  type SectionKind,
} from "@/lib/layout";
import { rememberTemplate } from "@/lib/saved-templates";
import { useAccount } from "@/lib/use-account";
import { AccountBar } from "./AccountBar";
import { SeatMap } from "./SeatMap";

const newSection = (index: number, id: string, kind: SectionKind = "rows"): SectionConfig => ({
  id,
  name: kind === "tables" ? "Tables" : `Section ${index}`,
  kind,
  rows: 15,
  cols: 6,
  newLine: kind === "tables",
  tables: 10,
  seatsPerTable: 8,
  tablesPerRow: 4,
});

const clamp = (value: number, max: number, min = 1) =>
  Math.min(max, Math.max(min, Math.round(value) || min));

type NumberFieldProps = { label: string; value: number; min?: number; max: number; onChange: (v: number) => void };

function NumberField({ label, value, min = 1, max, onChange }: NumberFieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clamp(+e.target.value, max, min))}
      />
    </label>
  );
}

type Props = {
  token?: string;
  initialName?: string;
  initialConfig?: LayoutConfig;
  owned?: boolean;
  ownedByOther?: boolean;
};

export function TemplateEditor({
  token,
  initialName = "Sunday service",
  initialConfig,
  owned = false,
  ownedByOther = false,
}: Props) {
  const router = useRouter();
  const { user, ready } = useAccount();
  const [claimed, setClaimed] = useState(false);
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
  const [mode, setMode] = useState<"seats" | "move">("seats");

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

  // The first drag pins every section where it is now, so only the dragged one moves.
  const moveSection = (id: string, dx: number, dy: number) => {
    const arranged = autoArrange(config.sections);
    change({
      freeLayout: true,
      sections: config.sections.map((s) => {
        const x = config.freeLayout ? (s.x ?? arranged[s.id].x) : arranged[s.id].x;
        const y = config.freeLayout ? (s.y ?? arranged[s.id].y) : arranged[s.id].y;
        return s.id === id ? { ...s, x: x + dx, y: y + dy } : { ...s, x, y };
      }),
    });
  };

  const addSection = (kind: SectionKind) => {
    const section = newSection(config.sections.length + 1, crypto.randomUUID().slice(0, 8), kind);
    if (config.freeLayout) {
      // Keep the hand-made arrangement and put the new section underneath, ready to drag.
      const arranged = autoArrange(config.sections);
      const bottom = Math.max(
        0,
        ...config.sections.map((s) => (s.y ?? arranged[s.id].y) + sectionSize(s).h),
      );
      const left = Math.min(...config.sections.map((s) => s.x ?? arranged[s.id].x));
      Object.assign(section, { x: left, y: bottom + 1.5 });
    }
    change({ sections: [...config.sections, section] });
  };

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

  const addToAccount = () =>
    run(async () => {
      const result = await api.claimTemplate(token!);
      if (!result?.ok) throw new Error("Couldn't add it. It may already be in another account.");
      setClaimed(true);
    });

  const inMyAccount = owned || claimed;

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
            {inMyAccount ? (
              <>
                <strong>Saved in your account.</strong> You&apos;ll find it on the start page whenever
                you&apos;re signed in. Anyone with this page&apos;s link can also edit it.
              </>
            ) : (
              <>
                <strong>Keep this page&apos;s link.</strong> It&apos;s the only way back to this template, and
                anyone who has it can edit.
                {ownedByOther && " This template belongs to someone else's account."}
              </>
            )}
          </div>
          <div className="notice-actions">
            {accountsAvailable && ready && user && !inMyAccount && !ownedByOther && (
              <button type="button" onClick={addToAccount} disabled={busy}>
                Add to my account
              </button>
            )}
            <button type="button" onClick={copyLink}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </section>
      )}

      {token && !inMyAccount && !ownedByOther && (
        <AccountBar
          user={user}
          ready={ready}
          signedOutText="Sign in to keep this template in your account, so you don't need the link."
        />
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
              <div className="segmented" role="radiogroup" aria-label="Section type">
                {(["rows", "tables"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={kindOf(section) === kind}
                    onClick={() => updateSection(section.id, { kind })}
                  >
                    {kind === "rows" ? "Rows of seats" : "Round tables"}
                  </button>
                ))}
              </div>
              {kindOf(section) === "rows" ? (
                <div className="two-up">
                  <NumberField
                    label="Rows"
                    value={section.rows}
                    max={LIMITS.rows}
                    onChange={(rows) => updateSection(section.id, { rows })}
                  />
                  <NumberField
                    label="Seats per row"
                    value={section.cols}
                    max={LIMITS.cols}
                    onChange={(cols) => updateSection(section.id, { cols })}
                  />
                </div>
              ) : (
                <div className="three-up">
                  <NumberField
                    label="Tables"
                    value={section.tables ?? 10}
                    max={LIMITS.tables}
                    onChange={(tables) => updateSection(section.id, { tables })}
                  />
                  <NumberField
                    label="Seats each"
                    value={section.seatsPerTable ?? 8}
                    min={2}
                    max={LIMITS.seatsPerTable}
                    onChange={(seatsPerTable) => updateSection(section.id, { seatsPerTable })}
                  />
                  <NumberField
                    label="Per row"
                    value={section.tablesPerRow ?? 4}
                    max={LIMITS.tablesPerRow}
                    onChange={(tablesPerRow) => updateSection(section.id, { tablesPerRow })}
                  />
                </div>
              )}
              <div className="section-actions">
                {index > 0 && !config.freeLayout && (
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
          <div className="add-buttons">
            <button
              type="button"
              disabled={config.sections.length >= LIMITS.sections}
              onClick={() => addSection("rows")}
            >
              Add rows
            </button>
            <button
              type="button"
              disabled={config.sections.length >= LIMITS.sections}
              onClick={() => addSection("tables")}
            >
              Add round tables
            </button>
          </div>

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
          <div className="preview-tools">
            <div className="segmented" role="radiogroup" aria-label="Preview mode">
              <button type="button" role="radio" aria-checked={mode === "seats"} onClick={() => setMode("seats")}>
                Edit seats
              </button>
              <button type="button" role="radio" aria-checked={mode === "move"} onClick={() => setMode("move")}>
                Move sections
              </button>
            </div>
            {config.freeLayout && (
              <button type="button" className="link-button" onClick={() => change({ freeLayout: false })}>
                Auto-arrange
              </button>
            )}
          </div>
          <p className="hint">
            {mode === "seats"
              ? "Tap a seat to change it: normal, then not in use, then removed. Gaps between sections are aisles."
              : "Drag a section by its outline to place it. Sections snap to half a seat."}
          </p>
          <SeatMap
            layout={preview}
            statusFor={(seat) => (seat.inactive ? "not_in_use" : "available")}
            onSeatTap={cycleSeat}
            onSectionMove={mode === "move" ? moveSection : undefined}
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
