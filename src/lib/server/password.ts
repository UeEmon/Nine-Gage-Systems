import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEYLEN, { N: n, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** scrypt$N$salt$hash の形で保存する */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N);
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, salt, hash] = stored.split("$");
  const cost = Number(n);
  if (kind !== "scrypt" || !salt || !hash || !Number.isInteger(cost) || cost < 1024 || cost > 1 << 20) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), cost);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** 存在しないユーザーでも同じ計算をして、応答時間でユーザーの有無が分からないようにする */
export const DUMMY_HASH = `scrypt$${N}$AAAAAAAAAAAAAAAAAAAAAA==$${Buffer.alloc(KEYLEN).toString("base64")}`;

export const MIN_PASSWORD = 10;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `パスワードは${MIN_PASSWORD}文字以上にしてください。`;
  if (password.length > 200) return "パスワードは200文字以内にしてください。";
  return null;
}

export function usernameProblem(username: string): string | null {
  if (!/^[A-Za-z0-9._@-]{3,40}$/.test(username)) return "ユーザー名は半角英数字と . _ @ - の3〜40文字にしてください。";
  return null;
}
