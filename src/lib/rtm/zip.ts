// ZIP ファイルを読む（RealTrainMod の車両パックは ZIP）。
// 無圧縮（stored）と deflate だけに対応する。展開はブラウザ・Node の DecompressionStream を使う。

export type ZipEntry = { path: string; data: Uint8Array };

const sig = (v: DataView, o: number) => v.getUint32(o, true);

/** ファイル名のバイト列を文字列に（UTF-8 フラグがなければ、日本語の Windows で作った ZIP の Shift_JIS も試す） */
export function decodeName(bytes: Uint8Array, utf8Flag: boolean): string {
  if (!utf8Flag) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      try {
        return new TextDecoder("shift_jis").decode(bytes);
      } catch {
        /* 下で UTF-8 として読む */
      }
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * ZIP の中身を全部読む。filter で読むファイルを絞れる（展開する前に判定する）。
 * 暗号化されたファイル・未対応の圧縮方式のファイルは飛ばす
 */
export async function readZip(buf: ArrayBuffer | Uint8Array, filter: (path: string) => boolean = () => true): Promise<ZipEntry[]> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 末尾の End of central directory を探す（コメントの分だけ前にずれることがある）
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (sig(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP ファイルではありません");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || sig(view, p) !== 0x02014b50) throw new Error("ZIP ファイルが壊れています");
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const path = decodeName(bytes.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0).replace(/\\/g, "/");
    p += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/") || (flags & 1) || !filter(path)) continue;
    if (local + 30 > bytes.length || sig(view, local) !== 0x04034b50) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compSize);
    if (method === 0) out.push({ path, data: raw.slice() });
    else if (method === 8) out.push({ path, data: await inflateRaw(raw) });
  }
  return out;
}
