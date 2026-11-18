import featureMap from "../../.github/features.json";

/**
 * 改善リクエスト（画面とサーバーの両方で使う定義）。
 * 送られたリクエストはサーバーに保存し、設定があれば GitHub の Issue にする（src/lib/server/feedback.ts）。
 */

export const FEEDBACK_CATEGORIES = {
  feature: "機能の追加・改善",
  bug: "不具合の報告",
  other: "その他・質問",
} as const;
export type FeedbackCategory = keyof typeof FEEDBACK_CATEGORIES;
export const FEEDBACK_CATEGORY_IDS = Object.keys(FEEDBACK_CATEGORIES) as FeedbackCategory[];

/** 機能区分（.github/features.json と同じ。Issue に書くと、その機能のラベルと担当者が自動で付く） */
export const FEEDBACK_FEATURES: { id: string; name: string }[] = featureMap.features.map((f) => ({ id: f.id, name: f.name }));

export const FEEDBACK_TITLE_MAX = 100;
export const FEEDBACK_BODY_MAX = 4000;

/** 画面に出す1件（自分の分。管理者には送った人も） */
export type FeedbackView = {
  id: string;
  category: FeedbackCategory;
  feature?: string;
  title: string;
  body: string;
  createdAt: string;
  issueNumber?: number;
  issueUrl?: string;
  /** GitHub に登録できなかった理由（管理者だけに見せる） */
  error?: string;
  username?: string;
};
