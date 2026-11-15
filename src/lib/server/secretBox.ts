import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Env } from "./store";

/**
 * 利用者のAPIキーを暗号化して保存する（AES-256-GCM）。
 *
 * 鍵は NINEGAGE_SECRET_KEY（推奨。32文字以上の乱数）。なければ NINEGAGE_DATA_DIR/secret.key を作って使う
 * （store.json とは別のファイル、権限600）。保存形式は "v1.<iv>.<tag>.<暗号文>"（base64url）。
 */

const PREFIX = "v1";

function dataDir(env: Env) {
  return env.NINEGAGE_DATA_DIR || path.join(process.cwd(), "data");
}

const fileKeys = new Map<string, Buffer>();

function fileKey(env: Env, create: boolean): Buffer | null {
  const file = path.join(dataDir(env), "secret.key");
  const cached = fileKeys.get(file);
  if (cached) return cached;
  let text: string | null = null;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (!text) {
    if (!create) return null;
    text = randomBytes(32).toString("hex");
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      writeFileSync(file, `${text}\n`, { mode: 0o600, flag: "wx" });
    } catch (err) {
      // 同時に作られたときは、先にできた方を使う
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      text = readFileSync(file, "utf8").trim();
    }
  }
  const key = createHash("sha256").update(text).digest();
  fileKeys.set(file, key);
  return key;
}

function envKey(env: Env): Buffer | null {
  const v = env.NINEGAGE_SECRET_KEY?.trim();
  if (!v) return null;
  if (v.length < 32) throw new Error("NINEGAGE_SECRET_KEY は32文字以上にしてください。");
  return createHash("sha256").update(v).digest();
}

/** 暗号化に使う鍵（環境変数があればそれ、なければファイル） */
function encryptionKey(env: Env): Buffer {
  return envKey(env) ?? fileKey(env, true)!;
}

/** 復号に試す鍵（あとから環境変数を設定しても、それまでの分を読めるようにファイルの鍵も試す） */
function decryptionKeys(env: Env): Buffer[] {
  return [envKey(env), fileKey(env, false)].filter((k): k is Buffer => !!k);
}

export function sealSecret(plain: string, env: Env = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** 復号できなければ null（鍵が変わった・壊れている） */
export function openSecret(sealed: string, env: Env = process.env): string | null {
  const [prefix, iv, tag, ct] = sealed.split(".");
  if (prefix !== PREFIX || !iv || !tag || !ct) return null;
  for (const key of decryptionKeys(env)) {
    try {
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      d.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
    } catch {
      // 次の鍵を試す
    }
  }
  return null;
}
