import { ApiError } from "./admin-api";
import type { AppearanceTextKey } from "../i18n/appearance-copy";
export type AppearanceIssue = { key: AppearanceTextKey; values?: Record<string, string> };
export function appearanceIssue(error: unknown): AppearanceIssue {
  if (!(error instanceof ApiError)) return { key: "failure" };
  const known: Record<string, AppearanceTextKey> = { "image-empty": "emptyFile", "image-size": "fileSize", "image-type": "fileType", "image-read": "fileRead", "favicon-format": "faviconFormat", "favicon-dimensions": "faviconDimensions", "image-dimensions": "imageDimensions", "asset-verification": "imageVerification" };
  const reason = error.fields.reason?.[0];
  if (reason && known[reason]) {
    const dimension = (name: string) => { const value = error.fields[name]?.[0]; return value && /^\d{1,10}$/.test(value) ? value : "?"; };
    return { key: known[reason], ...(reason === "favicon-dimensions" ? { values: { width: dimension("width"), height: dimension("height") } } : {}) };
  }
  if (error.status === 409) return { key: "conflict" };
  if (error.status === 410) return { key: "expiredUpload" };
  if (error.stage === "upload") return { key: error.status === 0 ? "uploadConnection" : "uploadConfiguration" };
  if (error.status === 403) return { key: "permission" };
  if (error.status === 413) return { key: "fileSize" };
  return { key: [400, 415].includes(error.status) ? "invalid" : "failure" };
}
