import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { currentUser } from "@/lib/server/auth";
import { signupOpen } from "@/lib/server/users";
import { BrandLogo } from "@/components/BrandLogo";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await currentUser()) redirect("/");
  return (
    <main className="page narrow">
      <h1>
        <BrandLogo height={44} />
      </h1>
      <LoginForm signup={signupOpen()} />
    </main>
  );
}
