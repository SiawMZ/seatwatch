"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api, connectRoom, type AddedChairs, type RoomData, type RoomPatch } from "@/lib/backend";
import { downloadRoomJpg } from "@/lib/export-jpg";
import {
  findTogether,
  MAX_ADDED,
  overlapsSeats,
  pickGroup,
  placeChairsNear,
  STATUS_META,
  STATUSES,
  statusOf,
  summarise,
  summaryText,
  type ChairDirection,
  type Seat,
  type SeatMapState,
  type Status,
} from "@/lib/layout";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, SeatMap, statusColor } from "./SeatMap";
import { forgetRoom, rememberRoom } from "@/lib/recent-rooms";
import { ThemeSwitch } from "./ThemeSwitch";

const REFRESH_MS = 30_000;
const ZOOM_STEP = 1.5;
const UNDO_LIMIT = 30;
const GROUP_MAX = 12;
const NO_SEATS: SeatMapState = {};

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
  const [leaveOpen, setLeaveOpen] = useState(false);
  const router = useRouter();
  const [qr, setQr] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState("");
  /** Size of the group being seated, while "Find" is open. */
  const [groupSize, setGroupSize] = useState<number | null>(null);
  // Only this phone's own marks can be undone. Each entry holds what the seats were before.
  const [history, setHistory] = useState<SeatMapState[]>([]);
  // Adding chairs: while open, a tap on the map shows where they'd go, or picks a batch already added.
  const [placing, setPlacing] = useState(false);
  const [chairCount, setChairCount] = useState(4);
  const [direction, setDirection] = useState<ChairDirection>("across");
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [chosenBatch, setChosenBatch] = useState<string | null>(null);

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

  // Kept on this phone so the start page can offer a one-tap way back in.
  const roomName = room?.name;
  useEffect(() => {
    if (roomName) rememberRoom(code, roomName);
  }, [code, roomName]);

  useEffect(() => {
    if (gone) forgetRoom(code);
  }, [code, gone]);

  useEffect(() => {
    if (!shareOpen) return;
    QRCode.toDataURL(window.location.href, { width: 400, margin: 1 }).then(setQr);
  }, [shareOpen]);

  const flash = (text: string) => {
    setMessage(text);
    setTimeout(() => setMessage(""), 2500);
  };

  const seats = room?.seats ?? NO_SEATS;
  const found = useMemo(
    () => (room && groupSize ? findTogether(room.layout, room.seats, groupSize) : null),
    [room, groupSize],
  );

  const commit = async (patch: SeatMapState, { undoable = true } = {}) => {
    if (Object.keys(patch).length === 0) return;
    if (undoable) {
      const before = Object.fromEntries(Object.keys(patch).map((id) => [id, statusOf(seats, id)]));
      setHistory((list) => [...list, before].slice(-UNDO_LIMIT));
    }
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

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((list) => list.slice(0, -1));
    commit(last, { undoable: false });
    flash("Undone");
  };

  const tapSeat = (seat: Seat) => {
    // While finding seats, tapping a highlighted stretch seats the whole group at once.
    const run = found?.runs.find((r) => r.includes(seat));
    if (run && groupSize) {
      const status = tool === "available" ? "occupied" : tool;
      commit(Object.fromEntries(pickGroup(run, seat, groupSize).map((s) => [s.id, status])));
      return;
    }
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

  // Shared by adding and removing chairs: show the change now, save it, then tell the other phones.
  const changeChairs = async (patch: RoomPatch, save: () => Promise<unknown>, undo: RoomPatch, done: string) => {
    changeCount.current++;
    pending.current++;
    setRoom((current) => (current ? applyPatch(current, patch) : current));
    try {
      if (!(await save())) setGone(true);
      else {
        link.current?.broadcast(patch);
        flash(done);
      }
    } catch {
      setRoom((current) => (current ? applyPatch(current, undo) : current));
      flash("That change didn't save. Please try again.");
    } finally {
      pending.current--;
      if (pending.current === 0) changeCount.current++;
    }
  };

  const openPlacing = () => {
    setPlacing(!placing);
    setSpot(null);
    setChosenBatch(null);
    setGroupSize(null);
    setDragMode(false);
  };

  const addChairs = () => {
    if (!room || !spot) return;
    const batch = Math.random().toString(36).slice(2, 8);
    const chairs: AddedChairs = placeChairsNear(room.layout, batch, spot, chairCount, direction);
    setSpot(null);
    changeChairs(
      { addChairs: chairs },
      () => api.addSeats(code, chairs),
      { removeChairs: `add-${batch}` },
      `Added ${chairCount} ${chairCount === 1 ? "chair" : "chairs"}`,
    );
  };

  const removeChairs = (batch: string) => {
    if (!room) return;
    const chairs = room.layout.seats.filter((s) => s.added && s.section === batch);
    setChosenBatch(null);
    changeChairs(
      { removeChairs: batch },
      () => api.removeSeats(code, batch),
      { addChairs: { seats: chairs, width: room.layout.width, height: room.layout.height } },
      `Removed ${chairs.length} ${chairs.length === 1 ? "chair" : "chairs"}`,
    );
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
      setHistory([]);
      changeCount.current++;
      setRoom((current) => (current ? applyPatch(current, patch) : current));
      link.current?.broadcast(patch);
      flash("Room reset for the next service");
    } catch {
      flash("Reset failed. Please try again.");
    }
  };

  // Leaving only disconnects this phone. If others are still here, nothing else needs saying.
  const leave = () => {
    if (connected && online > 1) router.push("/");
    else setLeaveOpen(true);
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
  const ghost = placing && spot ? placeChairsNear(room.layout, "preview", spot, chairCount, direction).seats : [];
  const ghostBlocked = overlapsSeats(room.layout, ghost);
  const chosen = chosenBatch ? room.layout.seats.filter((s) => s.added && s.section === chosenBatch) : [];

  return (
    <main className="room">
      <header className="room-header">
        <div className="room-title-row">
          <button type="button" className="leave" aria-label="Leave room" onClick={leave}>
            ‹
          </button>
          <div className="room-title">
            <h1>{room.name}</h1>
            <div className="room-meta">
              <span className={connected ? "dot live" : "dot"} />
              {connected ? `${online} here` : "Reconnecting…"}
            </div>
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
        onRowTap={placing ? undefined : tapRow}
        dragMode={dragMode}
        onDragMove={setDragPreview}
        onDragEnd={(list) => {
          setDragPreview([]);
          paint(list);
        }}
        highlight={chosen.length ? new Set(chosen.map((s) => s.id)) : (found?.seatIds ?? null)}
        onMapTap={
          placing
            ? (point, seat) => {
                setChosenBatch(seat?.added ? (seat.section ?? null) : null);
                setSpot(seat?.added ? null : point);
              }
            : undefined
        }
        ghost={ghost}
        ghostBlocked={ghostBlocked}
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
              Pinch the map with two fingers to zoom. Use Find to see where a group can sit together, then
              tap a highlighted seat to mark the whole group.
            </p>
            <ThemeSwitch />
          </section>
        </div>
      )}

      {leaveOpen && (
        <div className="leave-panel" role="dialog" aria-label="Leave room">
          <strong>You&apos;re the last one here</strong>
          <p className="hint">
            The room and its marks clear 2 hours after everyone leaves. Save a JPG first if you need the
            attendance. Anyone can rejoin with code <span className="code">{room.code}</span> until then.
          </p>
          <div className="report-actions">
            <button type="button" onClick={() => setLeaveOpen(false)}>
              Stay
            </button>
            <button type="button" onClick={() => downloadRoomJpg(room)}>
              Save JPG
            </button>
            <button type="button" className="primary" onClick={() => router.push("/")}>
              Leave room
            </button>
          </div>
        </div>
      )}

      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}

      <nav className="toolbar" aria-label="Marking tools">
        {placing && (
          <div className="find-bar place-bar" role="status">
            {chosen.length > 0 ? (
              <>
                <span className="find-result">
                  {chosen.length} added {chosen.length === 1 ? "chair" : "chairs"} selected
                </span>
                <button type="button" className="danger" onClick={() => removeChairs(chosenBatch!)}>
                  Remove
                </button>
                <button type="button" onClick={() => setChosenBatch(null)}>
                  Keep
                </button>
              </>
            ) : (
              <>
                <span className="find-result">
                  {!spot
                    ? `Tap the map where the ${chairCount === 1 ? "chair goes" : `${chairCount} chairs go`}. Tap an added chair to remove it.`
                    : ghostBlocked
                      ? "That's on top of other seats. Tap somewhere else."
                      : "Tap again to move them, or Add."}
                </span>
                <button type="button" onClick={openPlacing}>
                  Done
                </button>
                <div className="stepper">
                  <button
                    type="button"
                    aria-label="Fewer chairs"
                    disabled={chairCount <= 1}
                    onClick={() => setChairCount((n) => Math.max(1, n - 1))}
                  >
                    −
                  </button>
                  <strong>{chairCount}</strong>
                  <button
                    type="button"
                    aria-label="More chairs"
                    disabled={chairCount >= MAX_ADDED}
                    onClick={() => setChairCount((n) => Math.min(MAX_ADDED, n + 1))}
                  >
                    +
                  </button>
                </div>
                <div className="segmented" role="radiogroup" aria-label="Direction">
                  {(["across", "down"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      role="radio"
                      aria-checked={direction === d}
                      onClick={() => setDirection(d)}
                    >
                      {d === "across" ? "Across" : "Down"}
                    </button>
                  ))}
                </div>
                <button type="button" className="primary" disabled={!spot || ghostBlocked} onClick={addChairs}>
                  Add
                </button>
              </>
            )}
          </div>
        )}
        {groupSize !== null && found && (
          <div className="find-bar" role="status">
            <span>Seats together</span>
            <div className="stepper">
              <button
                type="button"
                aria-label="Smaller group"
                disabled={groupSize <= 2}
                onClick={() => setGroupSize((size) => Math.max(2, (size ?? 2) - 1))}
              >
                −
              </button>
              <strong>{groupSize}</strong>
              <button
                type="button"
                aria-label="Bigger group"
                disabled={groupSize >= GROUP_MAX}
                onClick={() => setGroupSize((size) => Math.min(GROUP_MAX, (size ?? 2) + 1))}
              >
                +
              </button>
            </div>
            <span className="find-result">
              {found.rows === 0
                ? "Nowhere fits"
                : `Fits in ${found.rows} ${room.layout.tables?.length ? "rows or tables" : found.rows === 1 ? "row" : "rows"}`}
            </span>
            <button type="button" onClick={() => setGroupSize(null)}>
              Done
            </button>
          </div>
        )}
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
                <span
                  className="swatch"
                  style={{
                    background: statusColor(status, "fill"),
                    borderColor: statusColor(status, "stroke"),
                    color: statusColor(status, "text"),
                  }}
                >
                  {meta.glyph}
                </span>
                {meta.label}
              </button>
            );
          })}
        </div>
        <div className="tool-options">
          <button type="button" aria-pressed={dragMode} onClick={() => setDragMode(!dragMode)}>
            Drag
          </button>
          <button
            type="button"
            aria-pressed={groupSize !== null}
            onClick={() => {
              setPlacing(false);
              setGroupSize(groupSize === null ? 2 : null);
            }}
          >
            Find
          </button>
          <button type="button" aria-pressed={placing} onClick={openPlacing}>
            Chairs
          </button>
          <button type="button" onClick={undo} disabled={history.length === 0}>
            Undo
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
  let layout = room.layout;
  let seats = patch.replaceSeats ?? (patch.seats ? { ...room.seats, ...patch.seats } : room.seats);
  if (patch.addChairs) {
    // The same chairs can arrive twice, from this phone and again from a refresh.
    const known = new Set(layout.seats.map((s) => s.id));
    layout = {
      ...layout,
      seats: [...layout.seats, ...patch.addChairs.seats.filter((s) => !known.has(s.id))],
      width: Math.max(layout.width, patch.addChairs.width),
      height: Math.max(layout.height, patch.addChairs.height),
    };
  }
  if (patch.removeChairs) {
    const batch = patch.removeChairs;
    const gone = layout.seats.filter((s) => s.added && s.section === batch).map((s) => s.id);
    layout = { ...layout, seats: layout.seats.filter((s) => !(s.added && s.section === batch)) };
    seats = { ...seats };
    for (const id of gone) delete seats[id];
  }
  return { ...room, layout, seats, extra: patch.extra ?? room.extra };
}
