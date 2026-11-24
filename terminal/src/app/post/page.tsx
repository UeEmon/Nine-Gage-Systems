import { redirect } from "next/navigation";
import { Header } from "../../components/Header";
import { PostForm } from "../../components/PostForm";
import { currentUser } from "../../lib/server";

export const dynamic = "force-dynamic";

export default async function PostPage() {
  const user = await currentUser();
  if (!user) redirect("/auth/login?next=/post");
  return (
    <div className="page-wrap">
      <Header user={user} next="/post" />
      <main className="page">
        <PostForm />
      </main>
    </div>
  );
}
