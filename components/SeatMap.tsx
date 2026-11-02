"use client";

import { useMemo, useRef, type PointerEvent } from "react";
import {
  doorPosition,
  rowsOf,
  STATUS_META,
  stagePosition,
  type Layout,
  type Seat,
  type Status,
} from "@/lib/layout";

type Props = {
  layout: Layout;
  statusFor: (seat: Seat) => Status;
  onSeatTap: (seat: Seat) => void;
  onRowTap?: (seats: Seat[]) => void;
  /** Dragging across seats paints them. Turns off scrolling while on. */
  dragMode?: boolean;
  onDragEnd?: (seats: Seat[]) => void;
  onDragMove?: (seats: Seat[]) => void;
  /** Pixels per seat, or null to fit the screen width. */
  cellPx?: number | null;
};

export function SeatMap({
  layout,
  statusFor,
  onSeatTap,
  onRowTap,
  dragMode = false,
  onDragEnd,
  onDragMove,
  cellPx = null,
}: Props) {
  const rows = useMemo(() => rowsOf(layout), [layout]);
  const seatsById = useMemo(() => new Map(layout.seats.map((s) => [s.id, s])), [layout]);
  const dragged = useRef<Map<string, Seat> | null>(null);
  const stage = stagePosition(layout);

  const addFromPoint = (event: PointerEvent) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const seat = seatsById.get(element?.closest("[data-seat]")?.getAttribute("data-seat") ?? "");
    if (!seat || !dragged.current || dragged.current.has(seat.id)) return;
    dragged.current.set(seat.id, seat);
    onDragMove?.([...dragged.current.values()]);
  };

  const dragHandlers = dragMode
    ? {
        onPointerDown: (event: PointerEvent) => {
          dragged.current = new Map();
          addFromPoint(event);
        },
        onPointerMove: addFromPoint,
        onPointerUp: () => {
          if (dragged.current) onDragEnd?.([...dragged.current.values()]);
          dragged.current = null;
        },
        onPointerCancel: () => {
          dragged.current = null;
          onDragMove?.([]);
        },
      }
    : {};

  return (
    <div className="map-scroll" style={{ touchAction: dragMode ? "none" : "auto" }}>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={cellPx ? { width: layout.width * cellPx } : { width: "100%" }}
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
