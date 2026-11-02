import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";

// Local stand-in for Supabase: runs the real supabase/schema.sql in memory.
// Data disappears when the dev server restarts. Never available in production.

const ALLOWED = new Set([
  "create_template",
  "get_template",
  "update_template",
  "create_room",
  "get_room",
  "mark_seats",
  "add_extra",
  "reset_room",
  "cleanup_rooms",
  "claim_template",
  "my_templates",
  "delete_template",
]);

// The bits of Supabase's sign-in system that schema.sql refers to. Nobody is ever signed in here.
const AUTH_STAND_IN = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
`;

const store = globalThis as unknown as {
  devDb?: Promise<PGlite>;
  devPresence?: Map<string, Map<string, number>>;
};

function database() {
  store.devDb ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite();
    await db.exec(AUTH_STAND_IN);
    await db.exec(await readFile(path.join(process.cwd(), "supabase", "schema.sql"), "utf8"));
    return db;
  })();
  return store.devDb;
}

function presence(code: string, clientId: string) {
  store.devPresence ??= new Map();
  const room = store.devPresence.get(code) ?? new Map<string, number>();
  store.devPresence.set(code, room);
  const now = Date.now();
  room.set(clientId, now);
  for (const [id, seen] of room) if (now - seen > 4000) room.delete(id);
  return { online: room.size };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });

  const { fn, args } = (await request.json()) as { fn: string; args: Record<string, unknown> };
  if (fn === "__presence") {
    return Response.json({ data: presence(String(args.code), String(args.clientId)) });
  }
  if (!ALLOWED.has(fn)) return Response.json({ error: "Unknown function" }, { status: 400 });

  try {
    const db = await database();
    const names = Object.keys(args);
    if (names.some((name) => !/^p_[a-z_]+$/.test(name))) {
      return Response.json({ error: "Bad argument" }, { status: 400 });
    }
    const list = names.map((name, i) => `${name} => $${i + 1}`).join(", ");
    const result = await db.query<{ data: unknown }>(
      `select public.${fn}(${list}) as data`,
      names.map((name) => args[name]),
    );
    return Response.json({ data: result.rows[0]?.data ?? null });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
