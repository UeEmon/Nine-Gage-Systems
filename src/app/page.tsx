import { Editor } from "@/components/Editor";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** ログインしていなくてもエディタは使える（AI提案だけはログインが必要） */
export default async function Page() {
  const user = await currentUser();
  return <Editor user={user} />;
}
