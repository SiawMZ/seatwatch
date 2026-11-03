import type { RoomData } from "./backend";
import {
  doorPosition,
  formatStamp,
  STATUS_META,
  STATUSES,
  stagePosition,
  statusOf,
  summarise,
} from "./layout";

const INK = "#2f2d29";
const MUTED = "#77736a";
const PAPER = "#f3f1ec";
const FONT = "Arial, Helvetica, sans-serif";

export function drawRoom(room: RoomData, date: Date) {
  const { layout, seats, extra } = room;
  const { counts, groups } = summarise(layout, seats);
  const cell = Math.max(22, Math.min(40, 1100 / layout.width));
  const pad = 48;
  const mapWidth = layout.width * cell;
  const width = Math.max(mapWidth + pad * 2, 900);
  const header = 214 + groups.length * 30;
  const height = header + layout.height * cell + pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * 2);
  canvas.height = Math.ceil(height * 2);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);

  const text = (value: string, x: number, y: number, size: number, color = INK, bold = false) => {
    ctx.fillStyle = color;
    ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`;
    ctx.fillText(value, x, y);
  };

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  text(room.name, pad, 64, 30, INK, true);
  text(formatStamp(date), pad, 92, 16, MUTED);
  text(`Attendance ${counts.occupied + extra}`, pad, 136, 24, INK, true);
  text(`${counts.occupied} seated + ${extra} extra`, pad, 160, 15, MUTED);

  let legendX = pad;
  for (const status of STATUSES) {
    const meta = STATUS_META[status];
    drawSeat(ctx, legendX, 176, 18, status);
    const label = `${meta.label} ${counts[status]}`;
    text(label, legendX + 25, 190, 15);
    ctx.font = `15px ${FONT}`;
    legendX += 25 + ctx.measureText(label).width + 24;
  }

  groups.forEach((group, i) => {
    text(
      `${group.name}: ${group.counts.occupied} seated, ${group.counts.available} available, ${group.counts.reserved} reserved`,
      pad,
      224 + i * 30,
      15,
      MUTED,
    );
  });

  const left = (width - mapWidth) / 2;
  const top = header;
  const stage = stagePosition(layout);
  ctx.fillStyle = "#e4e0d6";
  ctx.fillRect(left + stage.x * cell, top + stage.y * cell, stage.w * cell, stage.h * cell);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  text("STAGE", left + (stage.x + stage.w / 2) * cell, top + (stage.y + stage.h / 2) * cell, cell * 0.45, MUTED, true);

  for (const door of layout.doors) {
    const p = doorPosition(door, layout);
    text("DOOR", left + (p.x + p.w / 2) * cell, top + (p.y + 0.4) * cell, cell * 0.38, MUTED, true);
  }

  for (const table of layout.tables ?? []) {
    const x = left + table.cx * cell;
    const y = top + table.cy * cell;
    ctx.fillStyle = "#e4e0d6";
    ctx.strokeStyle = "#d4d0c6";
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, table.r - 0.7) * cell, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    text(`T${table.label}`, x, y, cell * 0.42, MUTED, true);
  }

  for (const seat of layout.seats) {
    drawSeat(ctx, left + seat.x * cell, top + seat.y * cell, cell, statusOf(seats, seat.id));
  }

  // Chairs added during the service get the same dashed outline as on screen.
  const batches = new Map<string | undefined, typeof layout.seats>();
  for (const seat of layout.seats) {
    if (seat.added) batches.set(seat.section, [...(batches.get(seat.section) ?? []), seat]);
  }
  ctx.save();
  ctx.strokeStyle = MUTED;
  ctx.setLineDash([cell * 0.2, cell * 0.15]);
  for (const chairs of batches.values()) {
    const x1 = Math.min(...chairs.map((s) => s.x));
    const y1 = Math.min(...chairs.map((s) => s.y));
    const x2 = Math.max(...chairs.map((s) => s.x + 1));
    const y2 = Math.max(...chairs.map((s) => s.y + 1));
    ctx.beginPath();
    ctx.roundRect(left + (x1 - 0.1) * cell, top + (y1 - 0.1) * cell, (x2 - x1 + 0.2) * cell, (y2 - y1 + 0.2) * cell, cell * 0.25);
    ctx.stroke();
  }
  ctx.restore();

  return canvas;
}

function drawSeat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  status: (typeof STATUSES)[number],
) {
  const meta = STATUS_META[status];
  const inset = size * 0.08;
  const side = size - inset * 2;
  ctx.fillStyle = meta.fill;
  ctx.strokeStyle = meta.stroke;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + inset, y + inset, side, side, size * 0.16);
  ctx.fill();
  ctx.stroke();
  if (meta.glyph) {
    ctx.save();
    ctx.fillStyle = meta.text;
    ctx.font = `bold ${size * 0.55}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(meta.glyph, x + size / 2, y + size / 2 + 1);
    ctx.restore();
  }
}

export function downloadRoomJpg(room: RoomData) {
  const date = new Date();
  const canvas = drawRoom(room, date);
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      const safeName = room.name.replace(/[^\w-]+/g, "-").toLowerCase();
      link.href = URL.createObjectURL(blob);
      link.download = `${safeName}-${date.toISOString().slice(0, 10)}.jpg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    },
    "image/jpeg",
    0.92,
  );
}
