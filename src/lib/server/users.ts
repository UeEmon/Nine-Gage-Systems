import { z } from "zod";
import { hashPassword, passwordProblem, usernameProblem, verifyPassword } from "./password";
import { ROLE_ORDER } from "@/lib/roles";
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
};

function row(u: StoredUser): UserRow {
  return { ...publicUser(u), createdAt: u.createdAt, selfRegistered: !!u.selfRegistered, ownKey: !!u.ownAi?.apiKeyEnc };
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

export async function createUser(data: StoreData, input: z.infer<typeof CreateUserSchema>): Promise<UserRow> {
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

export const SignupSchema = z.object({ username: z.string().trim().max(100), password: z.string().max(200) });

/** 自分でのユーザー登録。ロールは必ず「一般」（AIは自分のAPIキーで使う） */
export async function signupUser(data: StoreData, input: z.infer<typeof SignupSchema>, env: Env = process.env): Promise<StoredUser> {
  if (!signupOpen(env)) throw new UserError("このサーバーではユーザー登録を受け付けていません。管理者に依頼してください。", 403);
  if (data.users.length === 0) throw new UserError("サーバーの準備がまだです（最初の管理者がいません）。", 503);
  const problem = usernameProblem(input.username) ?? passwordProblem(input.password);
  if (problem) throw new UserError(problem);
  const lower = input.username.toLowerCase();
  if (data.users.some((u) => u.username.toLowerCase() === lower)) throw new UserError("そのユーザー名はすでに使われています。", 409);
  const user = newUser(input.username, "user", await hashPassword(input.password), true);
  data.users.push(user);
  return user;
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
  return user;
}
