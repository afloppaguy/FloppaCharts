import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-parts";
import { ThumbnailTester } from "@/components/thumbnail-tester";

export default function ThumbnailToolPage() {
  return (
    <div className="mx-auto grid max-w-[100rem] gap-5">
      <Link href="/tools" className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Tools
      </Link>
      <PageHeader title="Thumbnail tester" subtitle="See your artwork the way players meet it: one tile among dozens, at a glance." />
      <ThumbnailTester />
    </div>
  );
}
