import type { Metadata } from "next";
import { Room } from "@/components/Room";

export const metadata: Metadata = { title: "Room", robots: { index: false }, referrer: "no-referrer" };

export default async function Page({ params }: PageProps<"/r/[code]">) {
  const { code } = await params;
  const clean = decodeURIComponent(code).toUpperCase();
  return <Room key={clean} code={clean} />;
}
