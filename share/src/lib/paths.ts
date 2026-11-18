/** ログイン後に戻る先として受け付けるのは、このサイトの中のパスだけ */
export function safePath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.includes("|")) return "/";
  return next;
}
