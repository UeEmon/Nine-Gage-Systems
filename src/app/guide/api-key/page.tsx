import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/BrandLogo";
import { UserMenu } from "@/components/UserMenu";
import { PROVIDER_LABELS, DEFAULT_MODELS } from "@/lib/llm/types";
import { ROLE_LABELS } from "@/lib/roles";
import { currentUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const metadata = { title: "APIキー登録のチュートリアル | SenroLab" };

type Guide = {
  id: "anthropic" | "openai" | "gemini";
  site: { label: string; url: string };
  keyLooks: string;
  steps: React.ReactNode[];
  billing: string;
};

const GUIDES: Guide[] = [
  {
    id: "anthropic",
    site: { label: "Claude Console", url: "https://console.anthropic.com/settings/keys" },
    keyLooks: "sk-ant- で始まる長い文字列",
    steps: [
      <>
        <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">
          Claude Console
        </a>
        を開き、メールアドレスか Google アカウントでアカウントを作ります（Claude のチャット用アカウントとは別に作ることがあります）。
      </>,
      <>「Billing（請求）」でクレジットカードを登録し、クレジットを購入します（前払い。少額から買えます）。</>,
      <>
        「Settings」→「
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
          API Keys
        </a>
        」で「Create Key」を押し、わかりやすい名前（例: SenroLab）を付けて作ります。
      </>,
      <>表示されたキーをコピーします。キーはこの画面でしか全体を表示できないので、閉じる前にコピーしてください。</>,
    ],
    billing: "前払いのクレジットから引かれます。クレジットがなくなるとAI提案が失敗します。",
  },
  {
    id: "openai",
    site: { label: "OpenAI Platform", url: "https://platform.openai.com/api-keys" },
    keyLooks: "sk- で始まる長い文字列",
    steps: [
      <>
        <a href="https://platform.openai.com/" target="_blank" rel="noreferrer">
          OpenAI Platform
        </a>
        にログインします（ChatGPT と同じアカウントで入れますが、料金は ChatGPT の月額とは別です）。
      </>,
      <>「Settings」→「Billing」で支払い方法を登録し、クレジットを追加します。</>,
      <>
        「
        <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
          API keys
        </a>
        」で「Create new secret key」を押し、名前（例: SenroLab）を付けて作ります。
      </>,
      <>表示されたキーをコピーします。あとから全体を見ることはできません。</>,
    ],
    billing: "追加したクレジットから引かれます。ChatGPT Plus などの月額プランとは別の支払いです。",
  },
  {
    id: "gemini",
    site: { label: "Google AI Studio", url: "https://aistudio.google.com/apikey" },
    keyLooks: "AIza で始まる文字列",
    steps: [
      <>
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          Google AI Studio の API キー
        </a>
        を開き、Google アカウントでログインします。
      </>,
      <>「APIキーを作成」を押します（Google Cloud のプロジェクトを選ぶか、新しく作ります）。</>,
      <>作られたキーをコピーします。</>,
      <>無料枠だけだと回数や速さに制限があり、AI提案が途中で失敗することがあります。安定して使うには、そのプロジェクトに請求先（支払い方法）を設定してください。</>,
    ],
    billing: "無料枠を超えた分は、Google Cloud の請求先アカウントに請求されます。",
  },
];

/** プレミアムユーザー・一般ユーザー向けの、生成AIのAPIキーを作って登録するまでの手順 */
export default async function ApiKeyGuidePage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return (
    <div className="page-wrap">
      <header className="header">
        <h1>
          <Link href="/" aria-label="SenroLab のトップへ">
            <BrandLogo />
          </Link> 
          / APIキー登録のチュートリアル
        </h1>
        <UserMenu user={user} />
      </header>
      <main className="page guide">
        <section className="card">
          <h2>APIキー登録のチュートリアル</h2>
          <p>
            SenroLab の「AI提案」は、Claude・ChatGPT（OpenAI）・Gemini といった生成AIを使ってレイアウト案を作ります。
            生成AIを使うには、各社のサイトで<strong>APIキー</strong>（AIを使うための合言葉のような文字列）を作り、SenroLab に登録します。
            この手順は5〜10分ほどで終わります。
          </p>
          <ul className="steps">
            <li>
              <strong>一般</strong>のユーザーは、AI提案を使うのにAPIキーの登録が必要です。
            </li>
            <li>
              <strong>{ROLE_LABELS.ai}</strong>は登録しなくても管理者が設定したAIを使えます。自分のキーを登録すると、AI提案に自分のキーと好きなモデルを使えます（キーを削除すると元に戻ります）。
            </li>
            <li>AIの料金はキーの持ち主（あなた）の各社アカウントに請求されます。SenroLab からは請求しません。</li>
          </ul>
          <nav className="guide-toc">
            <a href="#choose">1. 使うAIを選ぶ</a>
            <a href="#create">2. APIキーを作る</a>
            <a href="#register">3. SenroLab に登録する</a>
            <a href="#safety">安全に使うために</a>
            <a href="#trouble">うまくいかないとき</a>
          </nav>
        </section>

        <section className="card" id="choose">
          <h2>1. 使うAIを選ぶ</h2>
          <p>どれでもAI提案を使えます。迷ったら Claude をおすすめします（SenroLab はおもに Claude で動作を確かめています）。</p>
          <table className="guide-table">
            <thead>
              <tr>
                <th>AI</th>
                <th>キーを作るサイト</th>
                <th>空欄のときのモデル</th>
              </tr>
            </thead>
            <tbody>
              {GUIDES.map((g) => (
                <tr key={g.id}>
                  <td>{PROVIDER_LABELS[g.id]}</td>
                  <td>
                    <a href={g.site.url} target="_blank" rel="noreferrer">
                      {g.site.label}
                    </a>
                  </td>
                  <td>
                    <code>{DEFAULT_MODELS[g.id]}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card" id="create">
          <h2>2. APIキーを作る</h2>
          <p className="hint">各社の画面の名前や場所は変わることがあります。見つからないときは、各社のヘルプで「API key」を探してください。</p>
          {GUIDES.map((g) => (
            <details key={g.id} className="guide-provider" open={g.id === "anthropic"}>
              <summary>{PROVIDER_LABELS[g.id]} のキーを作る</summary>
              <ol className="steps">
                {g.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
              <p className="hint">
                キーの見た目: {g.keyLooks}。料金: {g.billing}
              </p>
            </details>
          ))}
        </section>

        <section className="card" id="register">
          <h2>3. SenroLab に登録する</h2>
          <ol className="steps">
            <li>
              画面右上の「アカウント・AI設定」から<Link href="/account">アカウント</Link>画面を開きます。
            </li>
            <li>「AIの設定（自分のAPIキー）」で、キーを作った会社のAIを選びます。</li>
            <li>モデルはふつう空欄のままで大丈夫です（空欄なら各社のおすすめのモデルを使います）。別のモデルを使いたいときだけ、モデル名を入力します。</li>
            <li>「APIキー」の欄にコピーしたキーを貼り付けて、「保存する」を押します。</li>
            <li>
              <Link href="/">エディタ</Link>のAI欄に「（自分のAPIキー）」と出ていれば完了です。AI提案を試してみてください。
            </li>
          </ol>
          <p className="hint">
            保存したキーはサーバーに暗号化して保存し、画面には末尾4文字だけを表示します。管理者にもキーの全体は見えません。
            AIの会社を変えると、前に保存したキーは消えます（別の会社にキーを送らないため）。
          </p>
          <p>
            <Link className="button primary" href="/account">
              アカウント画面でAPIキーを登録する
            </Link>
          </p>
        </section>

        <section className="card" id="safety">
          <h2>安全に使うために</h2>
          <ul className="steps">
            <li>APIキーはパスワードと同じです。人に教えたり、SNS やメールに貼ったりしないでください。</li>
            <li>使いすぎが心配なときは、各社の請求画面で利用額の上限や通知を設定しておくと安心です。</li>
            <li>キーが漏れたかもしれないときは、各社の画面でそのキーを削除（無効化）し、新しいキーを作って登録し直してください。</li>
            <li>SenroLab で使うのをやめるときは、アカウント画面の「キーを削除」で消せます。</li>
          </ul>
        </section>

        <section className="card" id="trouble">
          <h2>うまくいかないとき</h2>
          <dl className="guide-faq">
            <dt>「APIキーが正しくない」「認証に失敗」と出る</dt>
            <dd>キーの前後に空白が入っていないか、途中で切れていないかを確かめ、もう一度貼り付けてください。選んだAIの会社とキーの会社が合っているかも確かめてください。</dd>
            <dt>「残高が足りない」「クォータ」「レート制限」と出る</dt>
            <dd>各社の請求画面でクレジットの残りや支払い方法を確かめてください。Gemini の無料枠では制限にかかりやすいので、請求先の設定をおすすめします。</dd>
            <dt>「モデルが見つからない」と出る</dt>
            <dd>モデル名の欄を空欄にして保存し直してください。各社のおすすめのモデルを使います。</dd>
            <dt>「保存したAPIキーを読めませんでした」と出る</dt>
            <dd>サーバーの設定が変わり、保存したキーを読めなくなりました。お手数ですが、アカウント画面でもう一度キーを入力してください。</dd>
          </dl>
          <p className="hint">
            解決しないときは、画面右上の<Link href="/feedback">改善リクエスト</Link>から「不具合」として送ってください（キーそのものは書かないでください）。
          </p>
        </section>
      </main>
    </div>
  );
}
