import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { currentUser } from "@/lib/server/auth";
import { signupOpen } from "@/lib/server/users";
import { safeNext } from "@/lib/server/terminal";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return (
    <main className="page narrow">
      <h1>
        <BrandLogo height={44} />
      </h1>
      <LoginForm signup={signupOpen()} next={next} />
    </main>
  );
}
