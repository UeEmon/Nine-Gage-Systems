import { VerifyForm } from "@/components/VerifyForm";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <main className="page narrow">
      <h1>
        <BrandLogo height={44} />
      </h1>
      <VerifyForm />
    </main>
  );
}
