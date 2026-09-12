import type {JsonMap} from "../types";

export type InferenceProgressPresentation = {
  completed: number;
  total: number;
  percent: number;
  indeterminate: boolean;
};

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function inferenceProgressPresentation(
  progress: JsonMap,
  active: boolean,
): InferenceProgressPresentation {
  const completed = nonNegative(progress.completed);
  const total = nonNegative(progress.total);
  const reportedPercent = nonNegative(progress.percent);
  const measured = total > 0 || reportedPercent > 0 || (!active && progress.percent !== undefined);
  const calculated = total > 0 ? 100 * completed / total : reportedPercent;
  const percent = Math.max(0, Math.min(100, reportedPercent > 0 ? reportedPercent : calculated));
  return {completed, total, percent, indeterminate: active && !measured};
}
