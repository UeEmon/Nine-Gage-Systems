const FORMATS = [
  { name: "WebM（VP9）", mime: "video/webm;codecs=vp9" },
  { name: "WebM（VP8）", mime: "video/webm;codecs=vp8" },
  { name: "MP4（H.264）", mime: "video/mp4;codecs=avc1" },
  { name: "WebM", mime: "video/webm" },
  { name: "MP4", mime: "video/mp4" },
];

export function recordingFormats() {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined" ||
      !HTMLCanvasElement.prototype.captureStream) return [];
  return FORMATS.filter(f => MediaRecorder.isTypeSupported(f.mime)).filter((f, _, supported) =>
    f.mime.includes(";") || !supported.some(other => other.mime.startsWith(f.mime + ";")));
}

/** 録画と再エンコードで同じコンテナ・コーデック・目標ビットレートを使う。 */
export function recordCanvas(canvas: HTMLCanvasElement, mimeType: string, videoBitsPerSecond: number) {
  const stream = canvas.captureStream(30);
  const release = () => stream.getTracks().forEach(track => track.stop());
  try {
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond });
    const chunks: Blob[] = [];
    const done = new Promise<Blob>((resolve, reject) => {
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => {
        release();
        reject(new Error("動画をエンコードできませんでした。形式または画質を変更してください。"));
      };
      recorder.onstop = () => {
        release();
        if (chunks.length) resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
        else reject(new Error("録画データがありません。"));
      };
    });
    recorder.start(500);
    return { recorder, done };
  } catch (err) {
    release();
    throw err;
  }
}

/** 録画をデコードし、元の解像度で再生しながら選択した形式へエンコードする。 */
export async function encodeVideo(source: Blob, mime: string, bitrate: number, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const url = URL.createObjectURL(source);
  let frame = 0;
  let recorder: MediaRecorder | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<Blob>((resolve, reject) => {
      abort = () => reject(new DOMException("エンコードを中止しました。", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      video.onerror = () => reject(new Error("録画を読み込めませんでした。"));
      video.onloadeddata = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("映像を変換できませんでした。");
          const session = recordCanvas(canvas, mime, bitrate);
          recorder = session.recorder;
          session.done.then(resolve, reject);
          const draw = () => {
            ctx.drawImage(video, 0, 0);
            frame = requestAnimationFrame(draw);
          };
          draw();
          video.onended = () => { if (recorder?.state === "recording") recorder.stop(); };
          video.play().catch(reject);
        } catch (err) {
          reject(err);
        }
      };
      video.src = url;
    });
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
    cancelAnimationFrame(frame);
    if (recorder?.state === "recording") recorder.stop();
    video.onerror = video.onended = video.onloadeddata = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
