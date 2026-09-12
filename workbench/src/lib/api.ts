import type {AnnotationRecord, JsonObject, ModalStatus, Project, Run, Sample} from "../types";

export const TOKEN_KEY = "modelforge.public-alpha.token";
export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

export function bootstrapSessionToken(
  locationValue: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage,
  browserHistory: Pick<History, "replaceState"> = history,
): string {
  const fragmentToken = new URLSearchParams(locationValue.hash.replace(/^#/, "")).get("token")?.trim() || "";
  if (fragmentToken && fragmentToken.length <= 512) {
    storage.setItem(TOKEN_KEY, fragmentToken);
    browserHistory.replaceState(null, "", `${locationValue.pathname}${locationValue.search}`);
  }
  return fragmentToken || storage.getItem(TOKEN_KEY) || "";
}
export function sessionToken(storage: Pick<Storage, "getItem"> = sessionStorage): string {
  return storage.getItem(TOKEN_KEY) || "";
}
async function responseError(response: Response): Promise<ApiError> {
  let message = `Request failed (${response.status})`;
  try { const value = await response.json() as JsonObject; message = String(value.error || value.message || message); }
  catch { /* response did not contain public JSON */ }
  return new ApiError(message, response.status);
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = sessionToken(); const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, {...init, cache: "no-store", headers});
  if (!response.ok) throw await responseError(response);
  return await response.json() as T;
}
async function post<T>(path: string, value: JsonObject = {}, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {method: "POST", signal, headers: {"Content-Type": "application/json"}, body: JSON.stringify(value)});
}
export async function authenticatedBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const token = sessionToken();
  const response = await fetch(path, {cache: "no-store", signal, headers: token ? {Authorization: `Bearer ${token}`} : {}});
  if (!response.ok) throw await responseError(response);
  return await response.blob();
}
const enc = encodeURIComponent;
export const api = {
  ready: (signal?: AbortSignal) => request<{ready: boolean; scope: string}>("/api/v1/ready", {signal}),
  projects: (signal?: AbortSignal) => request<{projects: Project[]}>("/api/v1/projects", {signal}),
  project: (id: string, signal?: AbortSignal) => request<Project>(`/api/v1/projects/${enc(id)}`, {signal}),
  samples: (projectId: string, datasetId: string, signal?: AbortSignal) => request<{items?: Sample[]; samples?: Sample[]}>(`/api/v1/projects/${enc(projectId)}/datasets/${enc(datasetId)}/samples`, {signal}),
  sampleContent: (projectId: string, datasetId: string, sampleId: string, signal?: AbortSignal) => authenticatedBlob(`/api/v1/projects/${enc(projectId)}/datasets/${enc(datasetId)}/samples/${enc(sampleId)}/content`, signal),
  annotation: (projectId: string, datasetId: string, sampleId: string, signal?: AbortSignal) => request<AnnotationRecord>(`/api/v1/projects/${enc(projectId)}/datasets/${enc(datasetId)}/samples/${enc(sampleId)}/annotations`, {signal}),
  saveAnnotation: (projectId: string, datasetId: string, sampleId: string, value: JsonObject, signal?: AbortSignal) => post<AnnotationRecord>(`/api/v1/projects/${enc(projectId)}/datasets/${enc(datasetId)}/samples/${enc(sampleId)}/annotations`, value, signal),
  runs: (projectId: string, signal?: AbortSignal) => request<{runs: Run[]}>(`/api/v1/runs?project_id=${enc(projectId)}`, {signal}),
  run: (id: string, signal?: AbortSignal) => request<Run>(`/api/v1/runs/${enc(id)}`, {signal}),
  artifact: (runId: string, artifactId: string, signal?: AbortSignal) => authenticatedBlob(`/api/v1/runs/${enc(runId)}/artifacts/${enc(artifactId)}`, signal),
  modal: (signal?: AbortSignal) => request<ModalStatus>("/api/v1/providers/modal", {signal}),
  launch: (projectId: string, actionId: string, value: JsonObject, signal?: AbortSignal) => post<Run>(`/api/v1/projects/${enc(projectId)}/actions/${enc(actionId)}/runs`, value, signal),
  cancel: (runId: string, signal?: AbortSignal) => post<Run>(`/api/v1/runs/${enc(runId)}/cancel`, {}, signal),
  recover: (runId: string, signal?: AbortSignal) => post<Run>(`/api/v1/runs/${enc(runId)}/recover`, {}, signal),
};
