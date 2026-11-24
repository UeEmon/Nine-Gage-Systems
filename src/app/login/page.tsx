import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { currentUser } from "@/lib/server/auth";
import { signupOpen } from "@/lib/server/users";
import { mailLinksReady } from "@/lib/server/mailer";
import Link from "next/link";
import { safeNext } from "@/lib/server/terminal";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return (
    <main className="page narrow">
      <h1>
        <Link href="/" aria-label="SenroLab のトップへ">
          <BrandLogo height={44} />
        </Link>
      </h1>
      <LoginForm signup={signupOpen()} forgot={mailLinksReady()} next={next} />
    </main>
  );
}
