import type { Metadata } from "next";
import Link from "next/link";
import { TechShell } from "@/components/tech/TechShell";
import { TechStartHead } from "@/components/tech/TechStartHead";
import { skeletonPath, skeletonVisits } from "@/components/tech/visit-flow/fixtures";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestDataBanner, TestPill } from "@/components/ui/TestBadge";
import { TimeRange } from "@/components/ui/TimeRange";
import { requireArea } from "@/lib/auth/guards";
import { TECH_START_HREFS, TECH_START_TABS } from "../../_tabs";

export const metadata: Metadata = { title: "זרימת ביקור · שלד · ניהול טכנאים" };

// Visit-flow skeleton entry (D81, D88 module 2): the fake visits, one per state, so the owner can
// open each step on the Preview. Fake data only (components/tech/visit-flow/fixtures.ts): no
// database call. Same guard as the real technician screens.
export default async function VisitFlowSkeletonIndex() {
  await requireArea("tech");
  return (
    <TechShell head={<TechStartHead title="זרימת ביקור · שלד" isTest={false} />} activeTab="home" activeIsCurrent={false} navTabs={TECH_START_TABS} navHrefs={TECH_START_HREFS}>
      <TestDataBanner />
      <section className="card" aria-label="ביקורים לדוגמה">
        {skeletonVisits().map((v) => (
          <Link key={v.key} href={skeletonPath(v.key)} className="li" style={{ color: "inherit", textDecoration: "none" }}>
            <span className="num" style={{ fontWeight: 700, fontSize: 13, flex: "none" }}>
              <TimeRange start={v.start} end={v.end} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontWeight: 700 }}>{v.customer}</span> {v.isTest && <TestPill />}
              <span className="sub" style={{ display: "block" }}>
                {v.street}, {v.city}
              </span>
            </span>
            <StatusPill status={v.status} />
          </Link>
        ))}
      </section>
    </TechShell>
  );
}
