import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { hashPassword, passwordProblem, usernameProblem, verifyPassword } from "./password";
import { ROLE_LABELS, ROLE_ORDER } from "@/lib/roles";
import { publicUser, type PublicUser } from "./session";
import { newUser, ROLES, type Env, type StoreData, type StoredUser } from "./store";

/** ユーザー管理の失敗（画面に出す日本語メッセージとHTTPステータス） */
export class UserError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export type UserRow = PublicUser & {
  createdAt: string;
  /** 自分で登録した */
  selfRegistered: boolean;
  /** 自分のAPIキーを設定している（キーそのものは返さない） */
  ownKey: boolean;
  email: string | null;
  /** メールの確認待ち */
  pending: boolean;
};

function row(u: StoredUser): UserRow {
  return {
    ...publicUser(u),
    createdAt: u.createdAt,
    selfRegistered: !!u.selfRegistered,
    ownKey: !!u.ownAi?.apiKeyEnc,
    email: u.email ?? null,
    pending: !!u.pendingVerify,
  };
}

export function listUsers(data: StoreData): UserRow[] {
  return data.users
    .map(row)
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.username.localeCompare(b.username));
}

export const CreateUserSchema = z.object({
  username: z.string().trim(),
  password: z.string(),
  role: z.enum(ROLES),
});

export const AI_FROM_GENERAL = `${ROLE_LABELS.ai}は一般ユーザーの中から選びます。一般で追加してから、ロールを「${ROLE_LABELS.ai}」に変えてください。`;

export async function createUser(data: StoreData, input: z.infer<typeof CreateUserSchema>): Promise<UserRow> {
  if (input.role === "ai") throw new UserError(AI_FROM_GENERAL);
  const problem = usernameProblem(input.username) ?? passwordProblem(input.password);
  if (problem) throw new UserError(problem);
  const lower = input.username.toLowerCase();
  if (data.users.some((u) => u.username.toLowerCase() === lower)) throw new UserError("そのユーザー名はすでに使われています。", 409);
  const user = newUser(input.username, input.role, await hashPassword(input.password));
  data.users.push(user);
  return row(user);
}

/** 自分でのユーザー登録を受け付けるか（NINEGAGE_SIGNUP=closed で止める。既定は受け付ける） */
export function signupOpen(env: Env = process.env): boolean {
  return env.NINEGAGE_SIGNUP !== "closed";
}

export const SignupSchema = z.object({
  username: z.string().trim().max(100),
  email: z.string().trim().max(254),
  password: z.string().max(200),
});

/** 確認メールのリンクの有効期限 */
export const VERIFY_HOURS = 24;

export function emailProblem(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return "メールアドレスの形が正しくありません。";
  return null;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** 期限が切れた確認待ちの登録を消す（ユーザー名とメールアドレスを空ける） */
export function purgeExpiredSignups(data: StoreData, now = Date.now()) {
  data.users = data.users.filter((u) => !u.pendingVerify || Date.parse(u.pendingVerify.expiresAt) > now);
}

export type SignupResult =
  /** 確認待ちの登録を作った。token を確認メールのリンクに入れる */
  | { kind: "created"; user: StoredUser; token: string }
  /** そのメールアドレスは登録済み。画面には同じ表示を返し、メールで知らせる（登録の有無を画面で漏らさない） */
  | { kind: "already"; username: string };

/**
 * 自分でのユーザー登録。ロールは必ず「一般」（AIは自分のAPIキーで使う）。
 * 確認メールのリンクを開くまではログインできない。同じメールアドレスで確認待ちの登録があれば作り直す。
 */
export async function signupUser(
  data: StoreData,
  input: z.infer<typeof SignupSchema>,
  env: Env = process.env,
  now = Date.now(),
): Promise<SignupResult> {
  if (!signupOpen(env)) throw new UserError("このサーバーではユーザー登録を受け付けていません。管理者に依頼してください。", 403);
  if (data.users.length === 0) throw new UserError("サーバーの準備がまだです（最初の管理者がいません）。", 503);
  const email = input.email.toLowerCase();
  const problem = usernameProblem(input.username) ?? emailProblem(email) ?? passwordProblem(input.password);
  if (problem) throw new UserError(problem);
  purgeExpiredSignups(data, now);
  const owner = data.users.find((u) => u.email === email && !u.pendingVerify);
  if (owner) return { kind: "already", username: owner.username };
  data.users = data.users.filter((u) => !(u.email === email && u.pendingVerify));
  const lower = input.username.toLowerCase();
  if (data.users.some((u) => u.username.toLowerCase() === lower)) throw new UserError("そのユーザー名はすでに使われています。", 409);
  const token = randomBytes(32).toString("base64url");
  const user = newUser(input.username, "user", await hashPassword(input.password), true);
  user.email = email;
  user.pendingVerify = { tokenHash: hashToken(token), expiresAt: new Date(now + VERIFY_HOURS * 3600_000).toISOString() };
  data.users.push(user);
  return { kind: "created", user, token };
}

/** 確認メールのリンクのトークンで登録を完了する */
export function verifyEmail(data: StoreData, token: string, now = Date.now()): StoredUser {
  const hash = hashToken(token);
  const user = data.users.find((u) => u.pendingVerify?.tokenHash === hash);
  if (!user || Date.parse(user.pendingVerify!.expiresAt) <= now) {
    throw new UserError("リンクが無効か、期限が切れています。もう一度ユーザー登録してください。", 400);
  }
  delete user.pendingVerify;
  return user;
}

export function signupMail(base: string, username: string, token: string) {
  return {
    subject: "【SenroLab】メールアドレスの確認",
    text:
      `${username} さん\n\nSenroLab（センロラボ）へのご登録ありがとうございます。\n` +
      `次のリンクを開いて「登録を完了する」を押すと、ログインできるようになります（${VERIFY_HOURS}時間有効）。\n\n` +
      `${base}/verify#${token}\n\n心当たりがない場合は、このメールを破棄してください。登録は完了しません。\n`,
  };
}

export function alreadyMail(base: string, username: string) {
  return {
    subject: "【SenroLab】このメールアドレスは登録済みです",
    text:
      `このメールアドレスで新しいユーザー登録がありましたが、すでにユーザー名「${username}」で登録されています。\n` +
      `ログインはこちら: ${base}/login\n` +
      `パスワードを忘れたときはこちら: ${base}/forgot\n\n心当たりがない場合は、このメールを破棄してください。\n`,
  };
}

/** パスワード再設定のリンクの有効期限 */
export const RESET_MINUTES = 60;

export const ForgotSchema = z.object({ email: z.string().trim().max(254) });
export const ResetSchema = z.object({ token: z.string().min(10).max(200), password: z.string().max(200) });

/**
 * パスワード再設定を頼む。そのメールアドレスの（確認済みの）ユーザーがいれば、リンクのトークンを作って返す。
 * いなければ null（画面には同じ表示を返し、登録の有無を漏らさない）。
 */
export function requestPasswordReset(data: StoreData, emailInput: string, now = Date.now()): { user: StoredUser; token: string } | null {
  const email = emailInput.trim().toLowerCase();
  if (emailProblem(email)) throw new UserError("メールアドレスの形が正しくありません。");
  const user = data.users.find((u) => u.email === email && !u.pendingVerify);
  if (!user) return null;
  const token = randomBytes(32).toString("base64url");
  user.passwordReset = { tokenHash: hashToken(token), expiresAt: new Date(now + RESET_MINUTES * 60_000).toISOString() };
  return { user, token };
}

/** メールのリンクのトークンで新しいパスワードにする。ほかの端末のログインは切れる */
export async function resetPassword(data: StoreData, input: z.infer<typeof ResetSchema>, now = Date.now()): Promise<StoredUser> {
  const hash = hashToken(input.token);
  const user = data.users.find((u) => u.passwordReset?.tokenHash === hash);
  if (!user || Date.parse(user.passwordReset!.expiresAt) <= now) {
    throw new UserError("リンクが無効か、期限が切れています。もう一度「パスワードを忘れた」からやり直してください。", 400);
  }
  const problem = passwordProblem(input.password);
  if (problem) throw new UserError(problem);
  user.passwordHash = await hashPassword(input.password);
  user.sessionVersion += 1;
  delete user.passwordReset;
  return user;
}

export function resetMail(base: string, username: string, token: string) {
  return {
    subject: "【SenroLab】パスワードの再設定",
    text:
      `${username} さん\n\nSenroLab（センロラボ）のパスワードの再設定を受け付けました。\n` +
      `次のリンクを開いて、新しいパスワードを決めてください（${RESET_MINUTES}分有効、1回だけ使えます）。\n\n` +
      `${base}/reset#${token}\n\n` +
      `ユーザー名: ${username}\n\n` +
      `心当たりがない場合は、このメールを破棄してください。パスワードは変わりません。\n`,
  };
}

export const UpdateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  password: z.string().optional(),
});

function adminCount(data: StoreData) {
  return data.users.filter((u) => u.role === "admin").length;
}

function find(data: StoreData, id: string) {
  const user = data.users.find((u) => u.id === id);
  if (!user) throw new UserError("ユーザーが見つかりません。", 404);
  return user;
}

/** ロールの変更とパスワードの再設定（管理者だけ）。変えるとそのユーザーのログインは切れる */
export async function updateUser(data: StoreData, id: string, input: z.infer<typeof UpdateUserSchema>): Promise<UserRow> {
  const user = find(data, id);
  if (input.role === "ai" && input.role !== user.role && user.pendingVerify) {
    throw new UserError(`メールの確認が済んでいないユーザーは、${ROLE_LABELS.ai}にできません。`);
  }
  if (input.role && input.role !== user.role) {
    if (user.role === "admin" && adminCount(data) <= 1) throw new UserError("管理者が1人もいなくなるため、変更できません。");
    user.role = input.role;
    user.sessionVersion += 1;
  }
  if (input.password !== undefined) {
    const problem = passwordProblem(input.password);
    if (problem) throw new UserError(problem);
    user.passwordHash = await hashPassword(input.password);
    user.sessionVersion += 1;
    delete user.passwordReset;
  }
  return row(user);
}

export function deleteUser(data: StoreData, id: string, actingUserId: string) {
  const user = find(data, id);
  if (user.id === actingUserId) throw new UserError("自分自身は削除できません。");
  if (user.role === "admin" && adminCount(data) <= 1) throw new UserError("管理者が1人もいなくなるため、削除できません。");
  data.users = data.users.filter((u) => u.id !== id);
}

export const ChangePasswordSchema = z.object({ current: z.string(), next: z.string() });

/** 自分のパスワードの変更（全員）。ほかの端末のログインは切れる */
export async function changeOwnPassword(data: StoreData, id: string, input: z.infer<typeof ChangePasswordSchema>) {
  const user = find(data, id);
  if (!(await verifyPassword(input.current, user.passwordHash))) throw new UserError("今のパスワードが違います。", 403);
  const problem = passwordProblem(input.next);
  if (problem) throw new UserError(problem);
  user.passwordHash = await hashPassword(input.next);
  user.sessionVersion += 1;
  delete user.passwordReset;
  return user;
}
