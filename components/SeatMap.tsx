"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  doorPosition,
  rowsOf,
  STATUS_META,
  stagePosition,
  type Layout,
  type Seat,
  type Status,
} from "@/lib/layout";

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
  /** 1 fits the map to the width of its box. Leave both out to let the map keep its own zoom. */
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
};

export function SeatMap({
  layout,
  statusFor,
  onSeatTap,
  onRowTap,
  dragMode = false,
  onDragEnd,
  onDragMove,
  zoom: controlledZoom,
  onZoomChange,
}: Props) {
  const rows = useMemo(() => rowsOf(layout), [layout]);
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
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ width: `${zoom * 100}%` }}
        role="group"
        aria-label="Seat map"
        {...dragHandlers}
      >
        <rect x={stage.x} y={stage.y} width={stage.w} height={stage.h} fill="#e4e0d6" />
        <text
          x={stage.x + stage.w / 2}
          y={stage.y + stage.h / 2}
          fontSize={0.6}
          fontWeight={700}
          fill="#77736a"
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
              fill="#77736a"
              textAnchor="middle"
              dominantBaseline="central"
            >
              DOOR
            </text>
          );
        })}

        {onRowTap &&
          rows.map(({ id, seats }) => {
            const first = seats.reduce((a, b) => (b.x < a.x ? b : a));
            const free = seats.filter((s) => statusFor(s) === "available").length;
            return (
              <g key={id} className="row-handle" onClick={() => !dragMode && onRowTap(seats)}>
                <title>Mark whole row</title>
                <rect x={first.x - 1.1} y={first.y + 0.08} width={0.95} height={0.84} rx={0.42} />
                <text
                  x={first.x - 0.625}
                  y={first.y + 0.5}
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
          return (
            <g
              key={seat.id}
              className="seat"
              data-seat={seat.id}
              data-status={seat.removed ? "removed" : status}
              onClick={dragMode ? undefined : () => onSeatTap(seat)}
            >
              {/* Fills the whole cell so near-misses between seats still count as a tap. */}
              <rect x={seat.x} y={seat.y} width={1} height={1} fill="transparent" />
              <rect
                x={seat.x + 0.08}
                y={seat.y + 0.08}
                width={0.84}
                height={0.84}
                rx={0.16}
                fill={seat.removed ? "none" : meta.fill}
                stroke={seat.removed ? "#b9b4a8" : meta.stroke}
                strokeWidth={0.05}
                strokeDasharray={seat.removed ? "0.12 0.12" : undefined}
              />
              {!seat.removed && meta.glyph && (
                <text
                  x={seat.x + 0.5}
                  y={seat.y + 0.52}
                  fontSize={0.55}
                  fontWeight={700}
                  fill={meta.text}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {meta.glyph}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
