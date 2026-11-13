import { Explore } from "@/components/explore";

export const dynamic = "force-dynamic";

export default async function WatchlistPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Explore sp={await searchParams} watch />;
}
