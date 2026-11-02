// Called daily by Vercel Cron. Removes abandoned rooms, and the database
// activity keeps a free Supabase project from being paused for inactivity.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_KEY;
  if (!url || !key) return Response.json({ skipped: "Supabase is not configured" });

  const response = await fetch(`${url}/rest/v1/rpc/cleanup_rooms`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok) return Response.json({ error: await response.text() }, { status: 502 });
  return Response.json(await response.json());
}
