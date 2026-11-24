import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { ResetForm } from "@/components/ResetForm";

export const dynamic = "force-dynamic";

export default function ResetPage() {
  return (
    <main className="page narrow">
      <h1>
        <Link href="/" aria-label="SenroLab のトップへ">
          <BrandLogo height={44} />
        </Link>
      </h1>
      <ResetForm />
    </main>
  );
}
