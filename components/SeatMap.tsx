"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  doorPosition,
  mapExtent,
  rowHandle,
  rowsOf,
  STATUS_META,
  stagePosition,
  type Layout,
  type Seat,
  type Status,
} from "@/lib/layout";

/** Seat colours come from CSS so they follow light and dark mode. The JPG uses STATUS_META instead. */
export const statusColor = (status: Status, part: "fill" | "stroke" | "text") => `var(--${status}-${part})`;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

type Props = {
  layout: Layout;
  statusFor: (seat: Seat) => Status;
  onSeatTap: (seat: Seat) => void;
  onRowTap?: (seats: Seat[]) => void;
  /** Dragging across seats paints them. Turns off one-finger scrolling while on. */
  dragMode?: boolean;
  onDragEnd?: (seats: Seat[]) => void;
  onDragMove?: (seats: Seat[]) => void;
  /** Seats to point out, for example where a group fits. Every other seat is faded. */
  highlight?: Set<string> | null;
  /** 1 fits the map to the width of its box. Leave both out to let the map keep its own zoom. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  /** Turns on arranging: sections can be dragged, and this gets the distance moved in seat widths. */
  onSectionMove?: (id: string, dx: number, dy: number) => void;
  /** Turns on placing chairs: any tap on the map reports its point in seat widths, and the seat under it. */
  onMapTap?: (point: { x: number; y: number }, seat: Seat | null) => void;
  /** Chairs about to be added, drawn as outlines. */
  ghost?: Seat[];
  ghostBlocked?: boolean;
};

type Moving = { id: string; startX: number; startY: number; unit: number; dx: number; dy: number };

/** How long a finger must rest on a section before it can be dragged, and how far it may wobble. */
const HOLD_MS = 300;
const HOLD_SLOP_PX = 8;

/** Room left on each side of the map while adding chairs, in seat widths. */
const PLACING_PAD = 2.5;

/** Moves snap to half a seat, so sections line up easily. */
const snap = (value: number) => Math.round(value * 2) / 2;

export function SeatMap({
  layout,
  statusFor,
  onSeatTap,
  onRowTap,
  dragMode = false,
  onDragEnd,
  onDragMove,
  highlight = null,
  zoom: controlledZoom,
  onZoomChange,
  onSectionMove,
  onMapTap,
  ghost = [],
  ghostBlocked = false,
}: Props) {
  const rows = useMemo(() => rowsOf(layout), [layout]);
  const arranging = Boolean(onSectionMove);
  const placing = Boolean(onMapTap);
  // While adding chairs, leave room beyond the outer sections so chairs can go there too.
  const view = useMemo(() => {
    const { left, right } = mapExtent(layout);
    const pad = placing ? PLACING_PAD : 0;
    return { x: left - pad, w: right - left + pad * 2 };
  }, [layout, placing]);
  // A dashed outline marks each batch of added chairs, so everyone can tell they aren't in the template.
  const addedBatches = useMemo(() => {
    const batches = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
    for (const seat of layout.seats) {
      if (!seat.added || !seat.section) continue;
      const b = batches.get(seat.section);
      batches.set(
        seat.section,
        b
          ? { x1: Math.min(b.x1, seat.x), y1: Math.min(b.y1, seat.y), x2: Math.max(b.x2, seat.x + 1), y2: Math.max(b.y2, seat.y + 1) }
          : { x1: seat.x, y1: seat.y, x2: seat.x + 1, y2: seat.y + 1 },
      );
    }
    return [...batches.entries()];
  }, [layout]);
  const [moving, setMoving] = useState<Moving | null>(null);
  const hold = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  // Read by the touch listener below, which can't see React state.
  const movingNow = useRef(false);
  const shift = (section?: string) =>
    moving && section === moving.id ? `translate(${snap(moving.dx)} ${snap(moving.dy)})` : undefined;
  const seatsById = useMemo(() => new Map(layout.seats.map((s) => [s.id, s])), [layout]);
  const [ownZoom, setOwnZoom] = useState(1);
  const zoom = controlledZoom ?? ownZoom;
  const setZoom = onZoomChange ?? setOwnZoom;

  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const dragged = useRef<Map<string, Seat> | null>(null);
  const pointers = useRef(0);
  // The zoom currently drawn on screen. A pinch draws straight to the page for smoothness,
  // then hands the final value to React.
  const shownZoom = useRef(zoom);
  const latest = useRef({ setZoom, onDragMove });
  useEffect(() => {
    latest.current = { setZoom, onDragMove };
  });

  // Zooming with the buttons keeps whatever is in the middle of the box in the middle.
  // The position is saved on every scroll, because by the time this runs the browser
  // has already trimmed the scroll position to fit the resized map.
  const lastScroll = useRef({ left: 0, top: 0 });
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const save = () => {
      lastScroll.current = { left: element.scrollLeft, top: element.scrollTop };
    };
    element.addEventListener("scroll", save, { passive: true });
    return () => element.removeEventListener("scroll", save);
  }, []);

  useLayoutEffect(() => {
    const element = box.current;
    const previous = shownZoom.current;
    if (!element || previous === zoom) return;
    const ratio = zoom / previous;
    const halfWidth = element.clientWidth / 2;
    const halfHeight = element.clientHeight / 2;
    element.scrollLeft = (lastScroll.current.left + halfWidth) * ratio - halfWidth;
    element.scrollTop = (lastScroll.current.top + halfHeight) * ratio - halfHeight;
    lastScroll.current = { left: element.scrollLeft, top: element.scrollTop };
    shownZoom.current = zoom;
  }, [zoom]);

  // Two-finger pinch zooms only the map, around the point between the fingers.
  // Touch events are used because the browser keeps sending them while it scrolls.
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let pinch: { distance: number; zoom: number; x: number; y: number } | null = null;

    const read = (touches: TouchList) => {
      const rect = element.getBoundingClientRect();
      const [a, b] = [touches[0], touches[1]];
      return {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        midX: (a.clientX + b.clientX) / 2 - rect.left,
        midY: (a.clientY + b.clientY) / 2 - rect.top,
      };
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 2) return;
      const { distance, midX, midY } = read(event.touches);
      const scale = element.clientWidth * shownZoom.current;
      pinch = {
        distance: Math.max(distance, 1),
        zoom: shownZoom.current,
        x: (element.scrollLeft + midX) / scale,
        y: (element.scrollTop + midY) / scale,
      };
      dragged.current = null;
      latest.current.onDragMove?.([]);
    };

    const onMove = (event: TouchEvent) => {
      // While a section is being dragged, the finger moves the section, not the page.
      if (movingNow.current) {
        event.preventDefault();
        return;
      }
      if (!pinch || event.touches.length !== 2) return;
      event.preventDefault();
      const { distance, midX, midY } = read(event.touches);
      const next = clampZoom((pinch.zoom * distance) / pinch.distance);
      const width = element.clientWidth * next;
      if (svg.current) svg.current.style.width = `${next * 100}%`;
      element.scrollLeft = pinch.x * width - midX;
      element.scrollTop = pinch.y * width - midY;
      lastScroll.current = { left: element.scrollLeft, top: element.scrollTop };
      shownZoom.current = next;
    };

    const onEnd = (event: TouchEvent) => {
      if (!pinch || event.touches.length >= 2) return;
      pinch = null;
      latest.current.setZoom(shownZoom.current);
    };

    // Safari's own pinch gesture, which would otherwise zoom the whole page.
    const stopGesture = (event: Event) => event.preventDefault();

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: false });
    element.addEventListener("touchend", onEnd);
    element.addEventListener("touchcancel", onEnd);
    element.addEventListener("gesturestart", stopGesture);
    return () => {
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onEnd);
      element.removeEventListener("gesturestart", stopGesture);
    };
  }, []);

  const stage = stagePosition(layout);

  // Moving sections. A mouse drags straight away. A finger has to press and hold first,
  // so a quick swipe over a section still scrolls the map.
  const startMoving = (id: string, x: number, y: number, target: Element, pointerId: number) => {
    const svgWidth = svg.current?.getBoundingClientRect().width ?? 1;
    // Keeps the drag going if the finger slides off the outline.
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Not every pointer can be captured, and the drag still works without it.
    }
    const next = { id, startX: x, startY: y, unit: svgWidth / view.w, dx: 0, dy: 0 };
    movingNow.current = true;
    setMoving(next);
  };

  const pressSection = (id: string, event: PointerEvent<SVGRectElement>) => {
    if (event.pointerType === "mouse") {
      startMoving(id, event.clientX, event.clientY, event.currentTarget, event.pointerId);
      return;
    }
    const target = event.currentTarget;
    const { clientX, clientY, pointerId } = event;
    clearTimeout(hold.current?.timer);
    hold.current = {
      x: clientX,
      y: clientY,
      timer: setTimeout(() => {
        hold.current = null;
        navigator.vibrate?.(15);
        startMoving(id, clientX, clientY, target, pointerId);
      }, HOLD_MS),
    };
  };

  const dragSection = (id: string, event: PointerEvent) => {
    if (hold.current) {
      // The finger moved before the hold finished, so this is a scroll, not a move.
      const distance = Math.hypot(event.clientX - hold.current.x, event.clientY - hold.current.y);
      if (distance > HOLD_SLOP_PX) cancelSectionMove();
      return;
    }
    if (moving?.id !== id) return;
    setMoving({
      ...moving,
      dx: (event.clientX - moving.startX) / moving.unit,
      dy: (event.clientY - moving.startY) / moving.unit,
    });
  };

  const dropSection = (id: string) => {
    if (hold.current) return cancelSectionMove();
    movingNow.current = false;
    if (moving?.id !== id) return;
    const dx = snap(moving.dx);
    const dy = snap(moving.dy);
    setMoving(null);
    if (dx || dy) onSectionMove?.(id, dx, dy);
  };

  const cancelSectionMove = () => {
    clearTimeout(hold.current?.timer);
    hold.current = null;
    movingNow.current = false;
    setMoving(null);
  };

  const addFromPoint = (event: PointerEvent) => {
    if (pointers.current > 1) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const seat = seatsById.get(element?.closest("[data-seat]")?.getAttribute("data-seat") ?? "");
    if (!seat || !dragged.current || dragged.current.has(seat.id)) return;
    dragged.current.set(seat.id, seat);
    onDragMove?.([...dragged.current.values()]);
  };

  const endPointer = () => {
    pointers.current = Math.max(0, pointers.current - 1);
  };

  const tapMap = (event: MouseEvent<SVGSVGElement>) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix || !onMapTap) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const id = (event.target as Element).closest("[data-seat]")?.getAttribute("data-seat") ?? "";
    onMapTap({ x: point.x, y: point.y }, seatsById.get(id) ?? null);
  };

  const dragHandlers = dragMode
    ? {
        onPointerDown: (event: PointerEvent) => {
          pointers.current++;
          if (pointers.current > 1) {
            dragged.current = null;
            onDragMove?.([]);
            return;
          }
          dragged.current = new Map();
          addFromPoint(event);
        },
        onPointerMove: addFromPoint,
        onPointerUp: () => {
          endPointer();
          if (dragged.current) onDragEnd?.([...dragged.current.values()]);
          dragged.current = null;
        },
        onPointerCancel: () => {
          endPointer();
          dragged.current = null;
          onDragMove?.([]);
        },
      }
    : {};

  return (
    <div ref={box} className="map-scroll" style={{ touchAction: dragMode ? "none" : "pan-x pan-y" }}>
      <svg
        ref={svg}
        viewBox={`${view.x} 0 ${view.w} ${layout.height}`}
        style={{ width: `${zoom * 100}%` }}
        className={[highlight && "finding", placing && "placing"].filter(Boolean).join(" ") || undefined}
        role="group"
        aria-label="Seat map"
        onClick={placing ? tapMap : undefined}
        {...dragHandlers}
      >
        <rect x={stage.x} y={stage.y} width={stage.w} height={stage.h} fill="var(--stage)" />
        <text
          x={stage.x + stage.w / 2}
          y={stage.y + stage.h / 2}
          fontSize={0.6}
          fontWeight={700}
          fill="var(--muted)"
          textAnchor="middle"
          dominantBaseline="central"
        >
          STAGE
        </text>

        {layout.doors.map((door) => {
          const p = doorPosition(door, layout);
          return (
            <text
              key={door}
              x={p.x + p.w / 2}
              y={p.y + 0.4}
              fontSize={0.5}
              fontWeight={700}
              fill="var(--muted)"
              textAnchor="middle"
              dominantBaseline="central"
            >
              DOOR
            </text>
          );
        })}

        {(layout.tables ?? []).map((table) => {
          const tableSeats = rows.find((r) => r.id === table.id)?.seats ?? [];
          const free = tableSeats.filter((s) => statusFor(s) === "available").length;
          return (
            <g
              key={table.id}
              className={onRowTap ? "table tappable" : "table"}
              transform={shift(table.section)}
              onClick={() => onRowTap && !dragMode && onRowTap(tableSeats)}
            >
              {onRowTap && <title>Mark whole table</title>}
              <circle cx={table.cx} cy={table.cy} r={Math.max(0.5, table.r - 0.7)} />
              <text
                x={table.cx}
                y={table.cy - (onRowTap ? 0.3 : 0)}
                fontSize={0.42}
                textAnchor="middle"
                dominantBaseline="central"
              >
                T{table.label}
              </text>
              {onRowTap && (
                <text
                  className="free"
                  x={table.cx}
                  y={table.cy + 0.3}
                  fontSize={0.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {free}
                </text>
              )}
            </g>
          );
        })}

        {onRowTap &&
          rows
            .filter((row) => !row.isTable)
            .map(({ id, seats }) => {
              const { x, y } = rowHandle(seats);
              const free = seats.filter((s) => statusFor(s) === "available").length;
              return (
                <g key={id} className="row-handle" onClick={() => !dragMode && onRowTap(seats)}>
                  <title>Mark whole row</title>
                  <rect x={x} y={y + 0.08} width={0.95} height={0.84} rx={0.42} />
                  <text
                    x={x + 0.475}
                    y={y + 0.5}
                    fontSize={0.5}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {free}
                  </text>
                </g>
              );
            })}

        {layout.seats.map((seat) => {
          const status = statusFor(seat);
          const meta = STATUS_META[status];
          const lit = highlight?.has(seat.id);
          return (
            <g
              key={seat.id}
              className={lit ? "seat lit" : "seat"}
              data-seat={seat.id}
              data-status={seat.removed ? "removed" : status}
              transform={shift(seat.section)}
              onClick={dragMode || arranging || placing ? undefined : () => onSeatTap(seat)}
            >
              {/* Fills the whole cell so near-misses between seats still count as a tap. */}
              <rect x={seat.x} y={seat.y} width={1} height={1} fill="transparent" />
              <rect
                x={seat.x + 0.08}
                y={seat.y + 0.08}
                width={0.84}
                height={0.84}
                rx={0.16}
                fill={seat.removed ? "none" : statusColor(status, "fill")}
                stroke={seat.removed ? "var(--line)" : statusColor(status, "stroke")}
                strokeWidth={0.05}
                strokeDasharray={seat.removed ? "0.12 0.12" : undefined}
              />
              {lit && (
                <rect
                  className="ring"
                  x={seat.x + 0.02}
                  y={seat.y + 0.02}
                  width={0.96}
                  height={0.96}
                  rx={0.2}
                  fill="none"
                  strokeWidth={0.1}
                />
              )}
              {!seat.removed && meta.glyph && (
                <text
                  x={seat.x + 0.5}
                  y={seat.y + 0.52}
                  fontSize={0.55}
                  fontWeight={700}
                  fill={statusColor(status, "text")}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {meta.glyph}
                </text>
              )}
            </g>
          );
        })}

        {addedBatches.map(([id, b]) => (
          <rect
            key={id}
            className="added-outline"
            x={b.x1 - 0.1}
            y={b.y1 - 0.1}
            width={b.x2 - b.x1 + 0.2}
            height={b.y2 - b.y1 + 0.2}
            rx={0.25}
          />
        ))}

        {ghost.map((seat) => (
          <rect
            key={seat.id}
            className={ghostBlocked ? "ghost blocked" : "ghost"}
            x={seat.x + 0.08}
            y={seat.y + 0.08}
            width={0.84}
            height={0.84}
            rx={0.16}
          />
        ))}

        {arranging &&
          (layout.boxes ?? []).map((section) => (
            <g key={section.id} className="section-box" transform={shift(section.id)}>
              <text x={section.x} y={section.y - 0.35} fontSize={0.5} fontWeight={700}>
                {section.name}
              </text>
              <rect
                x={section.x - 0.25}
                y={section.y - 0.25}
                width={section.w + 0.5}
                height={section.h + 0.5}
                rx={0.3}
                data-moving={moving?.id === section.id || undefined}
                onPointerDown={(event) => pressSection(section.id, event)}
                onPointerMove={(event) => dragSection(section.id, event)}
                onPointerUp={() => dropSection(section.id)}
                onPointerCancel={cancelSectionMove}
                onContextMenu={(event) => event.preventDefault()}
              />
            </g>
          ))}
      </svg>
    </div>
  );
}
