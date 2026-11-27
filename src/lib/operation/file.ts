import { normalizeOperation, type OperationPlan } from "./model";

const FORMAT = "senrolab-operation";

export function operationFile(plan: OperationPlan): string {
  return JSON.stringify({ format: FORMAT, version: 1, operation: plan }, null, 2);
}

export function readOperationFile(text: string): OperationPlan {
  const data = JSON.parse(text);
  if (data?.format !== FORMAT) throw new Error("SenroLabの運行計画ファイルを選んでください。");
  if (data.version !== 1) throw new Error("このバージョンの運行計画には対応していません。");

  const raw = data.operation;
  const plan = normalizeOperation(raw);
  if (!plan || !Array.isArray(raw.trains) || !raw.stationNames || typeof raw.stationNames !== "object" ||
      Array.isArray(raw.stationNames) || Object.values(raw.stationNames).some(name => typeof name !== "string") ||
      raw.trains.length !== plan.trains.length ||
      plan.trains.some((t, i) => !t.id || t.stops.length !== raw.trains[i].stops.length) ||
      new Set(plan.trains.map(t => t.id)).size !== plan.trains.length) {
    throw new Error("駅または列車のデータを読み込めません。");
  }
  return plan;
}
