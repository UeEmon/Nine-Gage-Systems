# ペーパークラフトジェネレーターとの連携API

「再現してみた」で作った仮オブジェクト（実在の製品にない、シミュレーション上だけの物）を、
別のコンテナで動くペーパークラフトジェネレーター（例: ai-paper-modelar）で展開図にするための取り決め。

SenroLab のサーバーがジェネレーターを呼び、受け取った展開図（SVG）を画面に出して印刷できるようにする。
ブラウザからジェネレーターを直接呼ぶことはない（トークンを画面に出さないため）。

## SenroLab 側の設定（環境変数）

| 名前 | 内容 |
| --- | --- |
| `PAPERCRAFT_URL` | ジェネレーターのベースURL（例: `http://papercraft:8080`）。未設定なら連携は無効で、展開図のボタンは出ない |
| `PAPERCRAFT_API_TOKEN` | 任意。設定すると `Authorization: Bearer <トークン>` を付けて呼ぶ |
| `PAPERCRAFT_TIMEOUT_MS` | 任意。1回の呼び出しの待ち時間の上限（既定 30000） |

## ジェネレーターが用意するAPI

### `POST {PAPERCRAFT_URL}/v1/nets`

要求（`Content-Type: application/json`）:

```json
{
  "source": "senrolab",
  "scale": "1/150",
  "paper": "A4",
  "object": {
    "name": "〇〇トンネル",
    "kind": "tunnel",
    "length": 248,
    "width": 60,
    "height": 40,
    "note": "山を貫く長いトンネル"
  },
  "notice": "SenroLab のシミュレーション上の仮オブジェクトです。実在の製品・鉄道会社の公式なものではありません。"
}
```

- `object.length` / `width` / `height` は模型の実寸（mm、1/150 に縮めた後の大きさ）。length は線路に沿った方向。
- `object.kind` は次のどれか: `tunnel`（トンネル）, `bridge`（鉄橋）, `viaduct`（高架橋）, `station`（駅舎）, `platform`（ホーム）, `building`（建物）, `landmark`（名所・ランドマーク）, `mountain`（山・丘）, `water`（川・海・湖）, `other`（その他）。
- `paper` は `A4` か `A3`（縦置き）。
- `notice` は展開図に印刷してほしい注意書き。

応答（200, `application/json`）:

```json
{
  "pages": ["<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"210mm\" height=\"297mm\" ...>...</svg>"],
  "warnings": ["トンネルの高さを30mmにしました"]
}
```

- `pages`: 用紙1枚ごとのSVG（1〜20枚）。実寸で印刷できるよう `width` / `height` を mm で指定する。1枚 2MB まで。
- `warnings`: 任意。利用者に見せる注意（日本語、20件まで）。
- 失敗したときは 4xx/5xx と `{ "error": "利用者に見せるメッセージ" }`。

SenroLab は SVG を `<img>` として表示する（SVG 内のスクリプトは動かない）。外部の画像やフォントは読み込まれないので、SVG の中で完結させる。

### `GET {PAPERCRAFT_URL}/health`

動いていれば 200（中身は問わない）。

## 置き方の例（docker compose）

ジェネレーターは SenroLab と同じネットワークにだけつなぎ、インターネットには公開しない。

```yaml
services:
  papercraft:
    image: ghcr.io/ueemon/ai-paper-modelar:stable
    expose: ["8080"]
    networks: [prod-edge]
  nine-gage:
    environment:
      PAPERCRAFT_URL: http://papercraft:8080
```
