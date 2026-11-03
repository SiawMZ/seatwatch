import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Layout, Seat, SeatMapState } from "./layout";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_KEY;

// Without Supabase settings the app talks to /api/dev/rpc, a throwaway local
// database that only exists under `next dev`.
export const usingDevBackend = !url || !key;

let client: SupabaseClient | null = null;
// The session is kept so a signed-in user stays signed in. PKCE is the safer sign-in
// flow for browser apps: the sign-in code in the address bar is useless on its own.
const supabase = () =>
  (client ??= createClient(url!, key!, {
    auth: { persistSession: true, flowType: "pkce", detectSessionInUrl: true },
  }));

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!usingDevBackend) {
    const { data, error } = await supabase().rpc(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  }
  const response = await fetch("/api/dev/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fn, args }),
  });
  // The local database only exists under `next dev`, so a deployed site lands here when its
  // Supabase settings were missing at build time.
  if (response.status === 404) {
    throw new Error("Supabase isn't set up for this site. Add its URL and key in Vercel, then redeploy.");
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body.data as T;
}

export type TemplateData = { name: string; layout: Layout; owned?: boolean; ownedByOther?: boolean };
export type RoomData = { name: string; layout: Layout; code: string; seats: SeatMapState; extra: number };
export type AddedChairs = { seats: Seat[]; width: number; height: number };
// Chairs travel as additions and removals, so two ushers adding at once both keep theirs.
export type RoomPatch = {
  seats?: SeatMapState;
  replaceSeats?: SeatMapState;
  extra?: number;
  addChairs?: AddedChairs;
  removeChairs?: string;
};

export const api = {
  createTemplate: (name: string, layout: Layout) =>
    rpc<{ token: string }>("create_template", { p_name: name, p_layout: layout }),
  getTemplate: (token: string) => rpc<TemplateData | null>("get_template", { p_token: token }),
  updateTemplate: (token: string, name: string, layout: Layout) =>
    rpc<{ ok: true } | null>("update_template", { p_token: token, p_name: name, p_layout: layout }),
  createRoom: (token: string) => rpc<{ code: string } | null>("create_room", { p_token: token }),
  getRoom: (code: string) => rpc<RoomData | null>("get_room", { p_code: code }),
  markSeats: (code: string, patch: SeatMapState) =>
    rpc<{ ok: true } | null>("mark_seats", { p_code: code, p_patch: patch }),
  addExtra: (code: string, delta: number) =>
    rpc<{ extra: number } | null>("add_extra", { p_code: code, p_delta: delta }),
  addSeats: (code: string, chairs: AddedChairs) =>
    rpc<{ ok: true } | null>("add_seats", {
      p_code: code,
      p_seats: chairs.seats,
      p_width: chairs.width,
      p_height: chairs.height,
    }),
  removeSeats: (code: string, batch: string) =>
    rpc<{ ok: true } | null>("remove_seats", { p_code: code, p_batch: batch }),
  resetRoom: (code: string) =>
    rpc<{ seats: SeatMapState; extra: number } | null>("reset_room", { p_code: code }),
  myTemplates: () => rpc<{ token: string; name: string }[]>("my_templates", {}),
  claimTemplate: (token: string) => rpc<{ ok: boolean } | null>("claim_template", { p_token: token }),
  deleteTemplate: (token: string) => rpc<{ ok: boolean } | null>("delete_template", { p_token: token }),
};

/** Signing in is optional and only exists with real Supabase, not the local stand-in. */
export const accountsAvailable = !usingDevBackend;

export const account = {
  /** Calls back with the current user straight away, then on every sign-in or sign-out. */
  watch(callback: (user: User | null) => void) {
    const { data } = supabase().auth.onAuthStateChange((_event, session) => {
      callback(session?.user ?? null);
      // Tidy the one-time sign-in code out of the address bar once it has been used.
      const address = new URL(window.location.href);
      if (session && address.searchParams.has("code")) {
        address.searchParams.delete("code");
        window.history.replaceState(null, "", address);
      }
    });
    return () => data.subscription.unsubscribe();
  },
  signInWithGoogle: () =>
    supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    }),
  signOut: () => supabase().auth.signOut(),
};

type RoomEvents = {
  onPatch: (patch: RoomPatch) => void;
  onOnline: (count: number) => void;
  onConnection: (connected: boolean) => void;
  /** Something may have been missed, so read the room again. */
  onResync: () => void;
};

export function connectRoom(code: string, events: RoomEvents) {
  const clientId = crypto.randomUUID();
  return usingDevBackend ? connectDev(code, clientId, events) : connectSupabase(code, clientId, events);
}

function connectSupabase(code: string, clientId: string, events: RoomEvents) {
  let wasConnected = false;
  const channel = supabase().channel(`room:${code}`, {
    config: { presence: { key: clientId }, broadcast: { self: false } },
  });
  channel
    .on("broadcast", { event: "patch" }, ({ payload }) => events.onPatch(payload as RoomPatch))
    .on("presence", { event: "sync" }, () => events.onOnline(Object.keys(channel.presenceState()).length))
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        channel.track({});
        events.onConnection(true);
        if (wasConnected) events.onResync();
        wasConnected = true;
      } else {
        events.onConnection(false);
      }
    });
  return {
    broadcast: (patch: RoomPatch) => {
      channel.send({ type: "broadcast", event: "patch", payload: patch });
    },
    close: () => {
      supabase().removeChannel(channel);
    },
  };
}

function connectDev(code: string, clientId: string, events: RoomEvents) {
  const tick = async () => {
    try {
      const { online } = await rpc<{ online: number }>("__presence", { code, clientId });
      events.onOnline(online);
      events.onConnection(true);
      events.onResync();
    } catch {
      events.onConnection(false);
    }
  };
  tick();
  const timer = setInterval(tick, 1000);
  return { broadcast: () => {}, close: () => clearInterval(timer) };
}
