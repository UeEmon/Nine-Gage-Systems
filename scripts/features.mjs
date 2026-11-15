#!/usr/bin/env node
// 機能マップ（.github/features.json）から、機能ごとの担当の設定ファイルを作る。
//
//   npm run features          … CODEOWNERS・PRの自動ラベル・Issueテンプレート・docs/FEATURES.md を作り直す
//   npm run features -- --check … 作り直したものと食い違いがないか、全ファイルがどれか1つの機能に入っているかを調べる（テストでも実行）
//
// パスの書き方は CODEOWNERS と同じ（/ で始まる。末尾が / ならフォルダ全体。* はフォルダをまたがない任意の文字列）。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_FILE = ".github/features.json";
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "out", "data", "coverage"]);
const GENERATED = "このファイルは .github/features.json から `npm run features` で作っています。直接編集しないでください。";

export const labelOf = (feature) => `feature:${feature.id}`;

export function loadMap(root = ROOT) {
  return JSON.parse(readFileSync(path.join(root, MAP_FILE), "utf8"));
}

/** CODEOWNERS 風のパスを、リポジトリ直下からの相対パスに当てる正規表現にする */
export function patternToRegExp(pattern) {
  const dir = pattern.endsWith("/");
  const body = pattern
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${body}${dir ? "/.+" : ""}$`);
}

export function validateMap(map) {
  const errors = [];
  const ids = new Set();
  for (const f of map.features) {
    if (!/^[a-z][a-z0-9-]*$/.test(f.id)) errors.push(`機能ID「${f.id}」は英小文字・数字・ハイフンで書く`);
    if (ids.has(f.id)) errors.push(`機能ID「${f.id}」が重複している`);
    ids.add(f.id);
    if (!f.name) errors.push(`機能「${f.id}」に name がない`);
    if (!/^[0-9a-f]{6}$/.test(f.color ?? "")) errors.push(`機能「${f.id}」の color は6桁の16進数`);
    // GitHub のラベルの説明は100文字まで
    if (!f.description || [...f.description].length > 100) errors.push(`機能「${f.id}」の description は1〜100文字`);
    if (!f.owners?.length) errors.push(`機能「${f.id}」に担当（owners）がいない`);
    for (const o of f.owners ?? []) if (!/^@[\w.-]+(\/[\w.-]+)?$/.test(o)) errors.push(`機能「${f.id}」の担当「${o}」は @ユーザー名 か @組織/チーム`);
    for (const p of f.paths) if (!p.startsWith("/")) errors.push(`機能「${f.id}」のパス「${p}」は / で始める`);
  }
  for (const p of map.protected.paths) if (!p.startsWith("/")) errors.push(`保護するパス「${p}」は / で始める`);
  return errors;
}

/** リポジトリのファイル（.gitignore の対象のうち大きなものは除く） */
export function listFiles(root = ROOT) {
  const out = [];
  const walk = (rel) => {
    for (const ent of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(r);
      } else if (!/(^|\/)(\.env(\..*)?\.local|\.env|next-env\.d\.ts|.*\.tsbuildinfo)$/.test(r)) {
        out.push(r);
      }
    }
  };
  walk("");
  return out.sort();
}

/** 各ファイルがどの機能に入るか。どこにも入らない・2つ以上に入るファイルを返す */
export function checkCoverage(map, files) {
  const matchers = map.features.map((f) => ({ id: f.id, res: f.paths.map(patternToRegExp) }));
  const uncovered = [];
  const overlapped = [];
  for (const file of files) {
    const hits = matchers.filter((m) => m.res.some((re) => re.test(file))).map((m) => m.id);
    if (hits.length === 0) uncovered.push(file);
    else if (hits.length > 1) overlapped.push(`${file}（${hits.join("・")}）`);
  }
  return { uncovered, overlapped };
}

const toGlob = (p) => p.replace(/^\//, "").replace(/\/$/, "/**");
const yamlStr = (s) => JSON.stringify(s);

function codeowners(map) {
  const lines = [
    `# ${GENERATED}`,
    "# 機能ごとの担当。PR で変更したファイルの担当の承認がないと main にマージできない",
    "# （main のブランチ保護で「Require review from Code Owners」を有効にしている）。",
    "# あとに書いた行ほど優先される。",
    "",
  ];
  for (const f of map.features) {
    lines.push(`# ── ${f.name}（${labelOf(f)}）`);
    for (const p of f.paths) lines.push(`${p} ${f.owners.join(" ")}`);
    lines.push("");
  }
  lines.push("# ── 保護する場所（機能の担当より優先）");
  lines.push(`# ${map.protected.description}`);
  for (const p of map.protected.paths) lines.push(`${p} ${map.protected.owners.join(" ")}`);
  return lines.join("\n") + "\n";
}

function labeler(map) {
  const lines = [`# ${GENERATED}`, "# PR で変更したファイルに合わせて、機能のラベルを自動で付ける（.github/workflows/feature-triage.yml）", ""];
  for (const f of map.features) {
    lines.push(`${yamlStr(labelOf(f))}:`, "  - changed-files:", "      - any-glob-to-any-file:");
    for (const p of f.paths) lines.push(`          - ${yamlStr(toGlob(p))}`);
  }
  return lines.join("\n") + "\n";
}

function featureDropdown(map) {
  const lines = [
    "  - type: dropdown",
    "    id: feature",
    "    attributes:",
    "      label: 機能区分",
    "      description: 選んだ機能のラベルが付き、その機能の担当者が自動で割り当てられます。",
    "      options:",
  ];
  for (const f of map.features) lines.push(`        - ${yamlStr(`${f.name}（${labelOf(f)}）`)}`);
  lines.push(`        - ${yamlStr("わからない・複数にまたがる")}`, "    validations:", "      required: true");
  return lines;
}

function issueTemplate(map, kind) {
  const bug = kind === "bug";
  const lines = [
    `# ${GENERATED}`,
    `name: ${bug ? "不具合の報告" : "機能の追加・改善"}`,
    `description: ${bug ? "動かない・表示がおかしいなど" : "新しい機能や、今ある機能の改善の提案"}`,
    `labels: [${bug ? "bug" : "enhancement"}]`,
    "body:",
    ...featureDropdown(map),
    "  - type: textarea",
    "    id: summary",
    "    attributes:",
    `      label: ${bug ? "起きていること" : "やりたいこと"}`,
    `      description: ${bug ? "どの画面で何をしたら、どうなったか" : "利用者として何ができるようになるとよいか"}`,
    "    validations:",
    "      required: true",
    "  - type: textarea",
    "    id: detail",
    "    attributes:",
    `      label: ${bug ? "期待していた動き・再現の手順" : "補足（画面のイメージ・参考など）"}`,
  ];
  return lines.join("\n") + "\n";
}

function featuresDoc(map) {
  const lines = [
    "# 機能マップと担当",
    "",
    `<!-- ${GENERATED} -->`,
    "",
    "SenroLab のソースを機能ごとに分け、機能ごとに担当者を決めています。担当者は、その機能のファイルを変える PR のレビュー（承認）と、その機能の Issue を受け持ちます。",
    "",
    "## しくみ",
    "",
    "- **担当の決め方**: `.github/features.json` の `owners` に GitHub のユーザー名（`@name`）かチーム（`@org/team`）を書き、`npm run features` を実行してコミットします。",
    "- **PR のレビュー**: 機能ごとの `CODEOWNERS` により、変更したファイルの担当者の承認が必要になります。ただしサーバー・API・CI など保護する場所（下の「保護する場所の担当」）は、機能の担当ではなく保護の担当者の承認が必要です。",
    "- **PR のラベル**: 変更したファイルに合わせて `feature:機能ID` のラベルが自動で付きます。",
    "- **Issue**: 「機能の追加・改善」「不具合の報告」のテンプレートで機能区分を選ぶと、ラベルが付き、その機能の担当者が割り当てられます。",
    "- **新しいファイル**: 置いた場所がどの機能にも入っていないと、テスト（`npm test`）が失敗します。`.github/features.json` のその機能の `paths` に足してください。新しい機能を作るときは、機能を1件足し、ファイルはその機能のフォルダにまとめて置くと担当の設定が1行で済みます。",
    "",
    "## 機能一覧",
    "",
    "| 機能 | ラベル | 担当 | 内容 |",
    "|---|---|---|---|",
  ];
  for (const f of map.features) lines.push(`| ${f.name} | \`${labelOf(f)}\` | ${f.owners.join(" ")} | ${f.description} |`);
  lines.push("", `保護する場所の担当: ${map.protected.owners.join(" ")}（${map.protected.paths.map((p) => `\`${p}\``).join("、")}）`, "", "## 機能ごとのファイル", "");
  for (const f of map.features) {
    lines.push(`### ${f.name}（\`${labelOf(f)}\`）`, "");
    for (const p of f.paths) lines.push(`- \`${p}\``);
    lines.push("");
  }
  return lines.join("\n");
}

export function generate(map) {
  return {
    ".github/CODEOWNERS": codeowners(map),
    ".github/labeler.yml": labeler(map),
    ".github/ISSUE_TEMPLATE/feature.yml": issueTemplate(map, "feature"),
    ".github/ISSUE_TEMPLATE/bug.yml": issueTemplate(map, "bug"),
    "docs/FEATURES.md": featuresDoc(map),
  };
}

function main() {
  const check = process.argv.includes("--check");
  const map = loadMap();
  const problems = validateMap(map);
  const outputs = generate(map);
  for (const [rel, content] of Object.entries(outputs)) {
    const abs = path.join(ROOT, rel);
    const current = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (current === content) continue;
    if (check) problems.push(`${rel} が機能マップと食い違っている（npm run features で作り直す）`);
    else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      console.log(`更新: ${rel}`);
    }
  }
  const { uncovered, overlapped } = checkCoverage(map, listFiles());
  for (const f of uncovered) problems.push(`どの機能にも入っていない: ${f}（.github/features.json の paths に足す）`);
  for (const f of overlapped) problems.push(`2つ以上の機能に入っている: ${f}`);
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`機能マップ OK（${map.features.length} 機能）`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
