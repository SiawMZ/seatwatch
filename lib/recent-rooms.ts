// Rooms opened on this phone, so an usher who leaves by mistake can get back in with one tap.
const KEY = "seatwatch.rooms";
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX = 5;

export type RecentRoom = { code: string; name: string; visitedAt: number };

function read(): RecentRoom[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function write(list: RecentRoom[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage can be blocked, and the app works without this list.
  }
}

/** Newest first, leaving out rooms older than a day, since those have almost certainly ended. */
export function recentRooms(): RecentRoom[] {
  const cutoff = Date.now() - KEEP_MS;
  return read()
    .filter((room) => room.visitedAt > cutoff)
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX);
}

export function rememberRoom(code: string, name: string) {
  write([{ code, name, visitedAt: Date.now() }, ...recentRooms().filter((r) => r.code !== code)].slice(0, MAX));
}

export function forgetRoom(code: string) {
  write(read().filter((r) => r.code !== code));
}

export function timeAgo(visitedAt: number) {
  const minutes = Math.round((Date.now() - visitedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}
