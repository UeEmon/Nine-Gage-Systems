import { redirect } from "next/navigation";
import { Editor } from "@/components/Editor";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return <Editor user={user} />;
}
