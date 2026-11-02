export type Status = "available" | "occupied" | "reserved" | "not_in_use";

export const STATUSES: Status[] = ["available", "occupied", "reserved", "not_in_use"];

// Shared by the on-screen map and the JPG, so both always look the same.
export const STATUS_META: Record<
  Status,
  { label: string; fill: string; stroke: string; text: string; glyph: string }
> = {
  available: { label: "Available", fill: "#bfe5c9", stroke: "#2e8b57", text: "#17492c", glyph: "" },
  occupied: { label: "Occupied", fill: "#2f2d29", stroke: "#2f2d29", text: "#ffffff", glyph: "×" },
  reserved: { label: "Reserved", fill: "#efc14f", stroke: "#a87d10", text: "#3d2d00", glyph: "R" },
  not_in_use: { label: "Not in use", fill: "#d9d5cb", stroke: "#d9d5cb", text: "#77736a", glyph: "–" },
};

export type Door = "front-left" | "front-right" | "back-left" | "back-centre" | "back-right";

export const DOORS: { id: Door; label: string }[] = [
  { id: "front-left", label: "Front left" },
  { id: "front-right", label: "Front right" },
  { id: "back-left", label: "Back left" },
  { id: "back-centre", label: "Back centre" },
  { id: "back-right", label: "Back right" },
];

export type SectionConfig = {
  id: string;
  name: string;
  rows: number;
  cols: number;
  /** Starts a new line of sections, for example a block behind the first ones. */
  newLine: boolean;
};

export type LayoutConfig = {
  sections: SectionConfig[];
  doors: Door[];
  /** Seats changed by hand in the editor. Kept apart so resizing a section keeps them. */
  overrides: Record<string, "inactive" | "removed">;
};

// Every arrangement becomes this flat list, so marking, counting and export
// don't care whether it came from blocks of rows or, later, round tables.
export type Seat = {
  id: string;
  x: number;
  y: number;
  group: string;
  row: string;
  inactive?: boolean;
  removed?: boolean;
};

export type Layout = LayoutConfig & { width: number; height: number; seats: Seat[] };

export const STAGE_HEIGHT = 1.6;
const SEATS_TOP = STAGE_HEIGHT + 1.4;
const BOTTOM_STRIP = 1.8;
const ROW_HANDLE = 1.3;
const SECTION_GAP = 1;
const LINE_GAP = 1.5;

export const LIMITS = { sections: 12, rows: 60, cols: 40, seats: 2000 };

export function generateLayout(config: LayoutConfig, includeRemoved = false): Layout {
  const lines: SectionConfig[][] = [];
  for (const section of config.sections) {
    if (section.newLine || lines.length === 0) lines.push([]);
    lines[lines.length - 1].push(section);
  }

  const lineWidth = (line: SectionConfig[]) =>
    line.reduce((sum, s) => sum + ROW_HANDLE + s.cols, 0) + SECTION_GAP * (line.length - 1);
  const width = Math.max(4, ...lines.map(lineWidth));

  const seats: Seat[] = [];
  let top = SEATS_TOP;
  for (const line of lines) {
    let left = (width - lineWidth(line)) / 2;
    for (const section of line) {
      for (let row = 0; row < section.rows; row++) {
        for (let col = 0; col < section.cols; col++) {
          const id = `${section.id}-${row}-${col}`;
          const override = config.overrides[id];
          if (override === "removed" && !includeRemoved) continue;
          seats.push({
            id,
            x: left + ROW_HANDLE + col,
            y: top + row,
            group: section.name,
            row: `${section.id}-${row}`,
            ...(override === "inactive" ? { inactive: true } : {}),
            ...(override === "removed" ? { removed: true } : {}),
          });
        }
      }
      left += ROW_HANDLE + section.cols + SECTION_GAP;
    }
    top += Math.max(...line.map((s) => s.rows)) + LINE_GAP;
  }

  return { ...config, width, height: top - LINE_GAP + BOTTOM_STRIP, seats };
}

export function doorPosition(door: Door, layout: Layout) {
  const w = 2.4;
  const bottom = layout.height - 1.1;
  switch (door) {
    case "front-left":
      return { x: 0, y: 0.3, w };
    case "front-right":
      return { x: layout.width - w, y: 0.3, w };
    case "back-left":
      return { x: 0, y: bottom, w };
    case "back-centre":
      return { x: (layout.width - w) / 2, y: bottom, w };
    case "back-right":
      return { x: layout.width - w, y: bottom, w };
  }
}

export function stagePosition(layout: Layout) {
  const w = Math.max(3, layout.width * 0.4);
  return { x: (layout.width - w) / 2, y: 0, w, h: STAGE_HEIGHT };
}

export type SeatMapState = Record<string, Status>;

export const statusOf = (seats: SeatMapState, id: string): Status => seats[id] ?? "available";

export type Counts = Record<Status, number> & { total: number };

function count(list: Seat[], seats: SeatMapState): Counts {
  const counts: Counts = { available: 0, occupied: 0, reserved: 0, not_in_use: 0, total: list.length };
  for (const seat of list) counts[statusOf(seats, seat.id)]++;
  return counts;
}

export function summarise(layout: Layout, seats: SeatMapState) {
  const groups = [...new Set(layout.seats.map((s) => s.group))].map((name) => ({
    name,
    counts: count(layout.seats.filter((s) => s.group === name), seats),
  }));
  return { counts: count(layout.seats, seats), groups };
}

export function rowsOf(layout: Layout) {
  const rows = new Map<string, Seat[]>();
  for (const seat of layout.seats) {
    if (seat.removed) continue;
    rows.set(seat.row, [...(rows.get(seat.row) ?? []), seat]);
  }
  return [...rows.entries()].map(([id, seats]) => ({ id, seats }));
}

/** Unbroken stretches of available seats within each row. A removed seat or a busy one breaks a stretch. */
export function availableRuns(layout: Layout, seats: SeatMapState) {
  const runs: Seat[][] = [];
  for (const row of rowsOf(layout)) {
    let run: Seat[] = [];
    for (const seat of [...row.seats].sort((a, b) => a.x - b.x)) {
      // Positions can carry tiny rounding errors, so "next seat along" allows a little slack.
      const joins = run.length > 0 && Math.abs(seat.x - run[run.length - 1].x - 1) < 0.01;
      if (statusOf(seats, seat.id) !== "available") {
        if (run.length) runs.push(run);
        run = [];
      } else if (joins || run.length === 0) {
        run.push(seat);
      } else {
        runs.push(run);
        run = [seat];
      }
    }
    if (run.length) runs.push(run);
  }
  return runs;
}

/** Where a group of `size` people can sit side by side. */
export function findTogether(layout: Layout, seats: SeatMapState, size: number) {
  const runs = availableRuns(layout, seats).filter((run) => run.length >= size);
  return {
    runs,
    seatIds: new Set(runs.flat().map((s) => s.id)),
    rows: new Set(runs.map((run) => run[0].row)).size,
  };
}

/** The `size` seats to give a group, starting from the tapped seat and shifting left near the end of a stretch. */
export function pickGroup(run: Seat[], seat: Seat, size: number) {
  const start = Math.min(run.indexOf(seat), run.length - size);
  return run.slice(start, start + size);
}

export function formatStamp(date: Date) {
  return date.toLocaleString("en-MY", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function summaryText(name: string, layout: Layout, seats: SeatMapState, extra: number, date: Date) {
  const { counts, groups } = summarise(layout, seats);
  return [
    `${name}, ${formatStamp(date)}`,
    `Attendance: ${counts.occupied + extra} (${counts.occupied} seated + ${extra} extra)`,
    `Available: ${counts.available}`,
    `Reserved: ${counts.reserved}`,
    `Not in use: ${counts.not_in_use}`,
    "",
    ...groups.map(
      (g) => `${g.name}: ${g.counts.occupied} seated, ${g.counts.available} available, ${g.counts.reserved} reserved`,
    ),
  ].join("\n");
}
