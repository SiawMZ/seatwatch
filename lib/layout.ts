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

export type SectionKind = "rows" | "tables";

export type SectionConfig = {
  id: string;
  name: string;
  /** Missing on templates made before round tables existed, which are all rows. */
  kind?: SectionKind;
  rows: number;
  cols: number;
  /** Starts a new line of sections, for example a block behind the first ones. Auto-arrange only. */
  newLine: boolean;
  tables?: number;
  seatsPerTable?: number;
  tablesPerRow?: number;
  /** Top-left corner in seat widths, used once sections have been moved by hand. */
  x?: number;
  y?: number;
};

export type LayoutConfig = {
  sections: SectionConfig[];
  doors: Door[];
  /** Seats changed by hand in the editor. Kept apart so resizing a section keeps them. */
  overrides: Record<string, "inactive" | "removed">;
  /** True once any section has been dragged. Otherwise sections are lined up automatically. */
  freeLayout?: boolean;
};

// Every arrangement becomes this flat list, so marking, counting and export
// don't care whether it came from blocks of rows or round tables.
export type Seat = {
  id: string;
  x: number;
  y: number;
  group: string;
  /** The row, or for round tables the table, that the seat belongs to. */
  row: string;
  section?: string;
  /** Position around a table, so "next to each other" can wrap round the circle. */
  order?: number;
  inactive?: boolean;
  removed?: boolean;
  /** A chair put out during a service. It lives in the room only, not the template. */
  added?: boolean;
};

export type Table = { id: string; label: string; cx: number; cy: number; r: number; section: string };
export type SectionBox = { id: string; name: string; x: number; y: number; w: number; h: number };

// Rooms opened before Stage 3 stored layouts without tables or boxes, so both are optional.
export type Layout = LayoutConfig & {
  width: number;
  height: number;
  seats: Seat[];
  tables?: Table[];
  boxes?: SectionBox[];
};

export const STAGE_HEIGHT = 1.6;
const SEATS_TOP = STAGE_HEIGHT + 1.4;
const BOTTOM_STRIP = 1.8;
const ROW_HANDLE = 1.3;
const SECTION_GAP = 1;
const LINE_GAP = 1.5;
const TABLE_GAP = 1;

export const LIMITS = {
  sections: 12,
  rows: 60,
  cols: 40,
  tables: 60,
  seatsPerTable: 16,
  tablesPerRow: 10,
  seats: 2000,
};

export const kindOf = (section: SectionConfig): SectionKind => section.kind ?? "rows";

/** Distance from a table's centre to the middle of its seats. */
const tableRadius = (seats: number) => Math.max(1.3, (seats * 1.2) / (2 * Math.PI));

function tableGrid(section: SectionConfig) {
  const seats = section.seatsPerTable ?? 8;
  const r = tableRadius(seats);
  const cell = 2 * r + 1 + TABLE_GAP;
  const perRow = Math.min(section.tablesPerRow ?? 4, section.tables ?? 1);
  return { seats, r, cell, perRow, count: section.tables ?? 1 };
}

export function sectionSize(section: SectionConfig) {
  if (kindOf(section) === "tables") {
    const { cell, perRow, count } = tableGrid(section);
    return { w: perRow * cell - TABLE_GAP, h: Math.ceil(count / perRow) * cell - TABLE_GAP };
  }
  return { w: ROW_HANDLE + section.cols, h: section.rows };
}

/** Lines sections up side by side, centred, starting a new line where asked. */
export function autoArrange(sections: SectionConfig[]) {
  const lines: SectionConfig[][] = [];
  for (const section of sections) {
    if (section.newLine || lines.length === 0) lines.push([]);
    lines[lines.length - 1].push(section);
  }
  const lineWidth = (line: SectionConfig[]) =>
    line.reduce((sum, s) => sum + sectionSize(s).w, 0) + SECTION_GAP * (line.length - 1);
  const width = Math.max(0, ...lines.map(lineWidth));

  const positions: Record<string, { x: number; y: number }> = {};
  let top = 0;
  for (const line of lines) {
    let left = (width - lineWidth(line)) / 2;
    for (const section of line) {
      positions[section.id] = { x: left, y: top };
      left += sectionSize(section).w + SECTION_GAP;
    }
    top += Math.max(...line.map((s) => sectionSize(s).h)) + LINE_GAP;
  }
  return positions;
}

export function generateLayout(config: LayoutConfig, includeRemoved = false): Layout {
  const arranged = autoArrange(config.sections);
  const placeOf = (s: SectionConfig) =>
    config.freeLayout ? { x: s.x ?? arranged[s.id].x, y: s.y ?? arranged[s.id].y } : arranged[s.id];

  // Shift everything so the left-most and top-most sections start at the edge.
  const spans = config.sections.map((s) => ({ ...placeOf(s), ...sectionSize(s) }));
  const minX = Math.min(0, ...spans.map((s) => s.x));
  const minY = Math.min(0, ...spans.map((s) => s.y));
  const contentWidth = Math.max(0, ...spans.map((s) => s.x + s.w)) - minX;
  const contentHeight = Math.max(0, ...spans.map((s) => s.y + s.h)) - minY;
  const width = Math.max(4, contentWidth);
  const offsetX = -minX + (width - contentWidth) / 2;
  const offsetY = SEATS_TOP - minY;

  const seats: Seat[] = [];
  const tables: Table[] = [];
  const boxes: SectionBox[] = [];
  let tableNumber = 0;

  const addSeat = (seat: Omit<Seat, "inactive" | "removed">) => {
    const override = config.overrides[seat.id];
    if (override === "removed" && !includeRemoved) return;
    seats.push({
      ...seat,
      ...(override === "inactive" ? { inactive: true } : {}),
      ...(override === "removed" ? { removed: true } : {}),
    });
  };

  for (const section of config.sections) {
    const place = placeOf(section);
    const left = place.x + offsetX;
    const top = place.y + offsetY;
    boxes.push({ id: section.id, name: section.name, x: left, y: top, ...sectionSize(section) });

    if (kindOf(section) === "tables") {
      const { seats: perTable, r, cell, perRow, count } = tableGrid(section);
      for (let t = 0; t < count; t++) {
        const cx = left + (t % perRow) * cell + r + 0.5;
        const cy = top + Math.floor(t / perRow) * cell + r + 0.5;
        const id = `${section.id}-t${t}`;
        tables.push({ id, label: String(++tableNumber), cx, cy, r, section: section.id });
        for (let k = 0; k < perTable; k++) {
          const angle = -Math.PI / 2 + (2 * Math.PI * k) / perTable;
          addSeat({
            id: `${id}-${k}`,
            x: cx + r * Math.cos(angle) - 0.5,
            y: cy + r * Math.sin(angle) - 0.5,
            group: section.name,
            row: id,
            section: section.id,
            order: k,
          });
        }
      }
      continue;
    }

    for (let row = 0; row < section.rows; row++) {
      for (let col = 0; col < section.cols; col++) {
        addSeat({
          id: `${section.id}-${row}-${col}`,
          x: left + ROW_HANDLE + col,
          y: top + row,
          group: section.name,
          row: `${section.id}-${row}`,
          section: section.id,
        });
      }
    }
  }

  return { ...config, width, height: SEATS_TOP + contentHeight + BOTTOM_STRIP, seats, tables, boxes };
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

export const ADDED_GROUP = "Added chairs";
export const MAX_ADDED = 40;

export type ChairDirection = "across" | "down";

function nearestSeat(layout: Layout, at: { x: number; y: number }) {
  let best: Seat | null = null;
  let bestDistance = Infinity;
  for (const seat of layout.seats) {
    if (seat.removed) continue;
    const distance = Math.hypot(seat.x + 0.5 - at.x, seat.y + 0.5 - at.y);
    if (distance < bestDistance) [best, bestDistance] = [seat, distance];
  }
  return best;
}

/**
 * A line of chairs put out during a service, starting where the map was tapped.
 * Chairs line up with the seat nearest the tap, since sections sit at fractions of a seat
 * and a fixed grid would leave them slightly off. Past the back or the sides, the map grows.
 */
export function placeChairs(layout: Layout, batch: string, at: { x: number; y: number }, count: number, direction: ChairDirection) {
  const across = direction === "across";
  const near = nearestSeat(layout, at);
  const align = (value: number, base?: number) =>
    base === undefined ? Math.round(value * 2) / 2 : base + Math.round(value - base);
  const x = align(at.x - 0.5, near?.x);
  let y = align(at.y - 0.5, near?.y);
  // Not into the stage. Whole steps keep the chairs on the same grid.
  if (y < SEATS_TOP) y += Math.ceil(SEATS_TOP - y - 0.001);

  const seats: Seat[] = Array.from({ length: count }, (_, i) => ({
    id: `add-${batch}-${i}`,
    x: across ? x + i : x,
    y: across ? y : y + i,
    group: ADDED_GROUP,
    // Chairs down an aisle are one behind another, so Find never treats them as side by side.
    row: `add-${batch}`,
    section: `add-${batch}`,
    added: true,
  }));
  // Chairs past either side are covered by mapExtent, so only the back needs to grow.
  return { seats, width: layout.width, height: Math.max(layout.height, y + (across ? 1 : count) + BOTTOM_STRIP) };
}

/**
 * Left and right edges of the map. Added chairs, and the counters beside them, can sit past
 * the template's own edges, so the map widens to show them.
 */
export function mapExtent(layout: Layout) {
  let left = 0;
  let right = layout.width;
  for (const seat of layout.seats) {
    if (!seat.added) continue;
    left = Math.min(left, seat.x - 1.2);
    right = Math.max(right, seat.x + 1.1);
  }
  return { left, right };
}

// Up to two seats away in any direction, closest first. Whole steps keep chairs lined up.
const STEPS = [0, -1, 1, -2, 2];
const NUDGES = STEPS.flatMap((dx) => STEPS.map((dy) => ({ dx, dy }))).sort(
  (a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy),
);

/** Like placeChairs, but a near miss slides to the closest free spot, so a narrow aisle is easy to hit. */
export function placeChairsNear(layout: Layout, batch: string, at: { x: number; y: number }, count: number, direction: ChairDirection) {
  for (const { dx, dy } of NUDGES) {
    const placed = placeChairs(layout, batch, { x: at.x + dx, y: at.y + dy }, count, direction);
    if (!overlapsSeats(layout, placed.seats)) return placed;
  }
  return placeChairs(layout, batch, at, count, direction);
}

/**
 * Top-left of a row's free-seat counter. It sits left of a row, but above a single
 * column of chairs, since an aisle has no room beside them.
 */
export function rowHandle(seats: Seat[]) {
  const column = seats.every((s) => s.added && s.x === seats[0].x);
  if (column) {
    const top = seats.reduce((a, b) => (b.y < a.y ? b : a));
    return { x: top.x + 0.025, y: top.y - 1 };
  }
  const first = seats.reduce((a, b) => (b.x < a.x ? b : a));
  return { x: first.x - 1.1, y: first.y };
}

/** True when any of the new chairs, or their free-seat counter, would sit on a seat or counter already on the map. */
export function overlapsSeats(layout: Layout, chairs: Seat[]) {
  if (chairs.length === 0) return false;
  const cells = [...chairs, rowHandle(chairs)];
  const taken = [
    ...layout.seats.filter((seat) => !seat.removed),
    ...rowsOf(layout)
      .filter((row) => !row.isTable)
      .map((row) => rowHandle(row.seats)),
  ];
  return cells.some((cell) => taken.some((t) => Math.abs(t.x - cell.x) < 0.9 && Math.abs(t.y - cell.y) < 0.9));
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

/** Seats grouped by row, or by table for round tables. */
export function rowsOf(layout: Layout) {
  const tableIds = new Set((layout.tables ?? []).map((t) => t.id));
  const rows = new Map<string, Seat[]>();
  for (const seat of layout.seats) {
    if (seat.removed) continue;
    rows.set(seat.row, [...(rows.get(seat.row) ?? []), seat]);
  }
  return [...rows.entries()].map(([id, seats]) => ({ id, seats, isTable: tableIds.has(id) }));
}

/** Free seats next to each other at a round table, where the last seat sits beside the first. */
function tableRuns(list: Seat[], seats: SeatMapState) {
  const ordered = [...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const busy = ordered.findIndex((s) => statusOf(seats, s.id) !== "available");
  if (busy === -1) return [ordered];
  // Start just after a taken seat, so a stretch that wraps past the first seat stays whole.
  const rotated = [...ordered.slice(busy + 1), ...ordered.slice(0, busy + 1)];
  const runs: Seat[][] = [];
  let run: Seat[] = [];
  for (const seat of rotated) {
    if (statusOf(seats, seat.id) === "available") run.push(seat);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/** Unbroken stretches of available seats within each row. A removed seat or a busy one breaks a stretch. */
export function availableRuns(layout: Layout, seats: SeatMapState) {
  const runs: Seat[][] = [];
  for (const row of rowsOf(layout)) {
    if (row.isTable) {
      runs.push(...tableRuns(row.seats, seats));
      continue;
    }
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
