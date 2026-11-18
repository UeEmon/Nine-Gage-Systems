import Link from "next/link";
import { MAKER_INFO } from "../../../src/lib/parts";
import type { Post } from "../lib/store";
import { formatDate } from "./Header";
import { LayoutSvg } from "./LayoutSvg";

export function PostCard({ post }: { post: Post }) {
  return (
    <Link href={`/l/${post.id}`} className="post-card">
      <div className="thumb">
        <LayoutSvg layout={post.layout} connectors={post.connectors} />
      </div>
      <div className="meta">
        <strong>{post.title}</strong>
        <span>
          <span className="tag">{MAKER_INFO[post.maker].label}</span>
          {post.connectors.length > 0 && <span className="tag connect">端子 {post.connectors.length}</span>}
          {post.width}×{post.height}mm
        </span>
        <span>
          {post.ownerName}・{formatDate(post.createdAt)}
        </span>
      </div>
    </Link>
  );
}
