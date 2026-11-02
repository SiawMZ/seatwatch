"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { api, connectRoom, type RoomData, type RoomPatch } from "@/lib/backend";
import { downloadRoomJpg } from "@/lib/export-jpg";
import {
  STATUS_META,
  STATUSES,
  statusOf,
  summarise,
  summaryText,
  type Seat,
  type SeatMapState,
  type Status,
} from "@/lib/layout";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, SeatMap } from "./SeatMap";

const REFRESH_MS = 30_000;
const ZOOM_STEP = 1.5;

export function Room({ code }: { code: string }) {
  const [room, setRoom] = useState<RoomData | null>(null);
  const [gone, setGone] = useState(false);
  const [connected, setConnected] = useState(true);
  const [online, setOnline] = useState(1);
  const [tool, setTool] = useState<Status>("occupied");
  const [dragMode, setDragMode] = useState(false);
  const [dragPreview, setDragPreview] = useState<Seat[]>([]);
  const [zoom, setZoom] = useState(1);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [qr, setQr] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState("");

  const link = useRef<ReturnType<typeof connectRoom> | null>(null);
  // Counts local changes, so a slower read that started earlier can't undo them on screen.
  const changeCount = useRef(0);
  const pending = useRef(0);

  const refresh = useCallback(async () => {
    const startedAt = changeCount.current;
    try {
      const latest = await api.getRoom(code);
      if (!latest) setGone(true);
      else if (pending.current === 0 && startedAt === changeCount.current) setRoom(latest);
    } catch {
      setConnected(false);
    }
  }, [code]);

  useEffect(() => {
    // The first read of the room comes from the server, so state only changes once it answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const connection = connectRoom(code, {
      onPatch: (patch: RoomPatch) => {
        changeCount.current++;
        setRoom((current) => (current ? applyPatch(current, patch) : current));
      },
      onOnline: setOnline,
      onConnection: setConnected,
      onResync: refresh,
    });
    link.current = connection;

    // Only a visible page counts as someone being in the room.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      connection.close();
    };
  }, [code, refresh]);

  useEffect(() => {
    if (!shareOpen) return;
    QRCode.toDataURL(window.location.href, { width: 400, margin: 1 }).then(setQr);
  }, [shareOpen]);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(""), 2500);
  };

  const commit = async (patch: SeatMapState) => {
    if (Object.keys(patch).length === 0) return;
    changeCount.current++;
    pending.current++;
    setRoom((current) => (current ? applyPatch(current, { seats: patch }) : current));
    try {
      const result = await api.markSeats(code, patch);
      if (!result) setGone(true);
      else link.current?.broadcast({ seats: patch });
    } catch {
      flash("That change didn't save. Please try again.");
    } finally {
      pending.current--;
      if (pending.current === 0) changeCount.current++;
    }
  };

  const seats = useMemo(() => room?.seats ?? {}, [room]);

  const tapSeat = (seat: Seat) => {
    commit({ [seat.id]: statusOf(seats, seat.id) === tool ? "available" : tool });
  };

  // Group actions leave "not in use" seats alone, since those are usually closed on purpose.
  const paint = (list: Seat[]) => {
    const patch: SeatMapState = {};
    for (const seat of list) {
      const current = statusOf(seats, seat.id);
      if (current === "not_in_use" && tool !== "not_in_use") continue;
      patch[seat.id] = tool;
    }
    commit(patch);
  };

  const tapRow = (list: Seat[]) => {
    const open = list.filter((s) => statusOf(seats, s.id) !== "not_in_use");
    if (open.length > 0 && open.every((s) => statusOf(seats, s.id) === tool)) {
      commit(Object.fromEntries(open.map((s) => [s.id, "available" as Status])));
    } else {
      paint(list);
    }
  };

  const changeExtra = async (delta: number) => {
    if (!room) return;
    changeCount.current++;
    pending.current++;
    setRoom((current) => (current ? { ...current, extra: Math.max(0, current.extra + delta) } : current));
    try {
      const result = await api.addExtra(code, delta);
      if (!result) setGone(true);
      else {
        setRoom((current) => (current ? { ...current, extra: result.extra } : current));
        link.current?.broadcast({ extra: result.extra });
      }
    } catch {
      flash("That change didn't save. Please try again.");
    } finally {
      pending.current--;
      if (pending.current === 0) changeCount.current++;
    }
  };

  const reset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setConfirmReset(false);
    try {
      const result = await api.resetRoom(code);
      if (!result) return setGone(true);
      const patch = { replaceSeats: result.seats, extra: result.extra };
      changeCount.current++;
      setRoom((current) => (current ? applyPatch(current, patch) : current));
      link.current?.broadcast(patch);
      flash("Room reset for the next service");
    } catch {
      flash("Reset failed. Please try again.");
    }
  };

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(done);
    } catch {
      flash("Couldn't copy on this device");
    }
  };

  if (gone) {
    return (
      <main className="page centered">
        <h1>This room has ended</h1>
        <p className="hint">Rooms clear 2 hours after everyone leaves, or the code may be wrong.</p>
        <Link className="button primary" href="/">
          Back to start
        </Link>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="page centered">
        <p className="hint">{connected ? "Opening room…" : "Can't reach the room. Retrying…"}</p>
      </main>
    );
  }

  const { counts, groups } = summarise(room.layout, seats);
  const preview = new Set(dragPreview.map((s) => s.id));
  const statusFor = (seat: Seat): Status =>
    preview.has(seat.id) && (statusOf(seats, seat.id) !== "not_in_use" || tool === "not_in_use")
      ? tool
      : statusOf(seats, seat.id);

  return (
    <main className="room">
      <header className="room-header">
        <div className="room-title">
          <h1>{room.name}</h1>
          <div className="room-meta">
            <span className={connected ? "dot live" : "dot"} />
            {connected ? `${online} here` : "Reconnecting…"}
          </div>
        </div>
        <div className="room-actions">
          <button type="button" onClick={() => setReportOpen(true)}>
            Report
          </button>
          <button type="button" onClick={() => setShareOpen(!shareOpen)} aria-expanded={shareOpen}>
            Invite · <span className="code">{room.code}</span>
          </button>
        </div>
      </header>

      {shareOpen && (
        <section className="share">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {qr && <img src={qr} alt={`QR code to join room ${room.code}`} width={180} height={180} />}
          <div>
            <p>
              Ushers can scan this, or enter code <strong className="code">{room.code}</strong> on the start page.
              Anyone who joins can mark seats.
            </p>
            <button type="button" onClick={() => copy(window.location.href, "Link copied")}>
              Copy link
            </button>
          </div>
        </section>
      )}

      <section className="counts" aria-label="Seat counts">
        {STATUSES.map((status) => (
          <div key={status} className="count" data-status={status}>
            <strong>{counts[status]}</strong>
            <span>{STATUS_META[status].label}</span>
          </div>
        ))}
      </section>

      <SeatMap
        layout={room.layout}
        statusFor={statusFor}
        onSeatTap={tapSeat}
        onRowTap={tapRow}
        dragMode={dragMode}
        onDragMove={setDragPreview}
        onDragEnd={(list) => {
          setDragPreview([]);
          paint(list);
        }}
        zoom={zoom}
        onZoomChange={setZoom}
      />

      {reportOpen && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Report">
          <div className="sheet-header">
            <h2>Report</h2>
            <button type="button" onClick={() => setReportOpen(false)}>
              Close
            </button>
          </div>
          <section className="report">
            <div className="attendance">
              <div>
                <h2>Attendance: {counts.occupied + room.extra}</h2>
                <p className="hint">
                  {counts.occupied} seated + {room.extra} extra (standing, children on laps)
                </p>
              </div>
              <div className="stepper">
                <button
                  type="button"
                  aria-label="One fewer extra"
                  onClick={() => changeExtra(-1)}
                  disabled={room.extra === 0}
                >
                  −
                </button>
                <span>{room.extra}</span>
                <button type="button" aria-label="One more extra" onClick={() => changeExtra(1)}>
                  +
                </button>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Section</th>
                  <th>Available</th>
                  <th>Occupied</th>
                  <th>Reserved</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.name}>
                    <td>{group.name}</td>
                    <td>{group.counts.available}</td>
                    <td>{group.counts.occupied}</td>
                    <td>{group.counts.reserved}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="report-actions">
              <button type="button" className="primary" onClick={() => downloadRoomJpg(room)}>
                Save JPG
              </button>
              <button
                type="button"
                onClick={() =>
                  copy(summaryText(room.name, room.layout, seats, room.extra, new Date()), "Summary copied")
                }
              >
                Copy summary
              </button>
              <button type="button" className={confirmReset ? "danger" : ""} onClick={reset}>
                {confirmReset ? "Tap again to clear all seats" : "Reset for next service"}
              </button>
            </div>
            <p className="hint">
              Nothing is kept after this room ends. It clears 2 hours after everyone leaves, so save a JPG
              first.
            </p>
            <p className="hint">
              Tips: the number beside each row is its available seats, and tapping it marks the whole row.
              Pinch the map with two fingers to zoom.
            </p>
          </section>
        </div>
      )}

      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}

      <nav className="toolbar" aria-label="Marking tools">
        <div className="tools">
          {STATUSES.map((status) => {
            const meta = STATUS_META[status];
            return (
              <button
                key={status}
                type="button"
                className="tool"
                aria-pressed={tool === status}
                onClick={() => setTool(status)}
              >
                <span className="swatch" style={{ background: meta.fill, borderColor: meta.stroke, color: meta.text }}>
                  {meta.glyph}
                </span>
                {meta.label}
              </button>
            );
          })}
        </div>
        <div className="tool-options">
          <button type="button" aria-pressed={dragMode} onClick={() => setDragMode(!dragMode)}>
            {dragMode ? "Drag to mark: on" : "Drag to mark: off"}
          </button>
          <div className="zoom">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom(clampZoom(zoom / ZOOM_STEP))}
            >
              −
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom(clampZoom(zoom * ZOOM_STEP))}
            >
              +
            </button>
          </div>
        </div>
      </nav>
    </main>
  );
}

function applyPatch(room: RoomData, patch: RoomPatch): RoomData {
  return {
    ...room,
    seats: patch.replaceSeats ?? (patch.seats ? { ...room.seats, ...patch.seats } : room.seats),
    extra: patch.extra ?? room.extra,
  };
}
