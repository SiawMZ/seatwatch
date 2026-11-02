import type { Metadata } from "next";
import { TemplateLoader } from "@/components/TemplateLoader";

// Edit links are private, so they shouldn't be indexed or leak through referrers.
export const metadata: Metadata = { title: "Edit template", robots: { index: false }, referrer: "no-referrer" };

export default async function Page({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  return <TemplateLoader key={token} token={token} />;
}
