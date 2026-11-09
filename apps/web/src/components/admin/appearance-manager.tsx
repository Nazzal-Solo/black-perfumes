"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Check, Eye, ImagePlus, Palette, RefreshCw, Save, Send, Undo2, X } from "lucide-react";
import { ApiError } from "@/lib/admin-api";
import { brandingSlots, themePresets, brandingUrl, sameAppearance, validBrandingFile, loadAppearance, saveAppearance, previewAppearance, publishAppearance, discardAppearance, uploadBranding, type AppearanceConfig, type AppearanceState, type BrandingAsset, type BrandingSlot, type BrandingUpload, type ThemePresets } from "@/lib/appearance-admin";
import type { Appearance } from "@/lib/appearance";
import { useAppearanceText, type AppearanceTextKey } from "@/i18n/appearance-copy";
import { AdminDialog, useAdminUi } from "./admin-ui";

export function ThemeCards({ value, published, themes, disabled, onChange }: { value: AppearanceConfig["themePreset"]; published: AppearanceConfig["themePreset"]; themes: ThemePresets; disabled: boolean; onChange: (value: AppearanceConfig["themePreset"]) => void }) {
  const t = useAppearanceText();
  return <fieldset className="appearance-themes" disabled={disabled}><legend>{t("themes")}</legend><p className="admin-muted">{t("themesHelp")}</p><div className="appearance-theme-grid">{themePresets.map(preset => <label className={`appearance-theme-card ${value === preset ? "selected" : ""}`} key={preset}><input type="radio" name="appearance-theme" value={preset} checked={value === preset} onChange={() => onChange(preset)} /><span className="appearance-swatches" aria-hidden="true">{[themes[preset].background, themes[preset].surface, themes[preset].accent, themes[preset].text].map((color, i) => <i key={i} style={{ background: color }} />)}</span><strong>{t(preset)}</strong><span className="appearance-theme-flags">{value === preset && <span><Check size={14} />{t("selected")}</span>}{published === preset && <span>{t("publishedLabel")}</span>}</span></label>)}</div></fieldset>;
}

export function AppearancePreview({ appearance }: { appearance: Appearance }) {
  const t = useAppearanceText(); const colors = appearance.tokens;
  return <div className="appearance-preview-canvas" style={{ background: colors.background, color: colors.text }}><div className="appearance-preview-nav" style={{ background: appearance.themePreset === "light-elegance" ? "#152B20" : colors.surface, color: appearance.themePreset === "light-elegance" ? "#F0EDE5" : colors.text }}>{appearance.assets.logo && <Image src={appearance.assets.logo} alt="Berfumes Black" width={160} height={80} unoptimized />}<span>{t(appearance.themePreset)}</span></div><div className="appearance-preview-hero" style={{ backgroundColor: "#090D0B", backgroundImage: appearance.assets.hero ? `linear-gradient(90deg,#000c,#0004),url(${JSON.stringify(appearance.assets.hero)})` : undefined }}><h3>{t("heroTitle")}</h3><p>{t("tagline")}</p><span style={{ background: colors.accent, color: colors.onAccent }}>{t("collection")}</span></div><div className="appearance-preview-collections">{(["men", "women", "unisex"] as const).map(slot => <div key={slot} style={{ backgroundColor: colors.surface, backgroundImage: appearance.assets[slot] ? `linear-gradient(0deg,#000d,transparent),url(${JSON.stringify(appearance.assets[slot])})` : undefined, color: appearance.assets[slot] ? "#F0EDE5" : colors.text }}><strong>{t(slot)}</strong></div>)}</div></div>;
}

function BrandingImage({ url, label, expectedImage }: { url: string | null; label: string; expectedImage: boolean }) {
  const t = useAppearanceText(); const [failed, setFailed] = useState("");
  return url && failed !== url ? <Image src={url} alt={label} width={640} height={360} unoptimized onError={() => setFailed(url)} /> : <span><ImagePlus size={30} />{url || expectedImage ? t("imageError") : t("noImage")}</span>;
}

export function AppearanceManager({ onExpired, onStateChange }: { onExpired: () => void; onStateChange: (value: { dirty: boolean; busy: boolean }) => void }) {
  const t = useAppearanceText(); const { toast, confirm } = useAdminUi();
  const [state, setState] = useState<AppearanceState | null>(null); const [config, setConfig] = useState<AppearanceConfig | null>(null);
  const [themes, setThemes] = useState<ThemePresets | null>(null); const [assets, setAssets] = useState<BrandingAsset[]>([]);
  const [attempt, setAttempt] = useState(0); const [loadedAttempt, setLoadedAttempt] = useState(-1);
  const [error, setError] = useState<AppearanceTextKey | null>(null); const [operation, setOperation] = useState("");
  const [uploadSlot, setUploadSlot] = useState<BrandingSlot | null>(null); const [progress, setProgress] = useState(0);
  const [uploadErrors, setUploadErrors] = useState<Partial<Record<BrandingSlot, AppearanceTextKey>>>({});
  const [preview, setPreview] = useState<Appearance | null>(null);
  const tasks = useRef<Partial<Record<BrandingSlot, BrandingUpload>>>({}); const pending = useRef<AbortController | null>(null); const locked = useRef(false);
  const mounted = useRef(true); const callbacks = useRef({ onExpired, onStateChange }); callbacks.current = { onExpired, onStateChange };
  const busy = !!operation; const loading = loadedAttempt !== attempt; const dirty = !!(state && config && !sameAppearance(state.draft, config));
  const unpublished = !!(state && !sameAppearance(state.draft, state.published));
  const queued = Object.keys(tasks.current).length > 0;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); callbacks.current.onStateChange({ dirty: false, busy: false }); }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    loadAppearance(controller.signal).then(data => {
      if (controller.signal.aborted) return;
      setState(data.state); setConfig(data.state.draft); setThemes(data.themes); setAssets(data.assets); setError(null); tasks.current = {}; setUploadErrors({});
    }).catch(e => { if (!controller.signal.aborted) report(e); }).finally(() => { if (!controller.signal.aborted) setLoadedAttempt(attempt); });
    return () => controller.abort();
  // report only reads stable callbacks and React state setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  useEffect(() => { callbacks.current.onStateChange({ dirty: dirty || queued, busy }); }, [dirty, queued, busy]);
  useEffect(() => {
    if (!dirty && !queued && !busy) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, queued, busy]);
  function message(e: unknown): AppearanceTextKey { return e instanceof ApiError ? e.status === 409 ? "conflict" : e.status === 410 ? "expiredUpload" : [400, 413, 415].includes(e.status) ? "invalid" : "failure" : "failure"; }
  function report(e: unknown) { if (e instanceof ApiError && e.status === 401) callbacks.current.onExpired(); else setError(message(e)); }
  function begin(name: string) { if (locked.current) return null; locked.current = true; setOperation(name); setError(null); const controller = new AbortController(); pending.current = controller; return controller; }
  function finish() { locked.current = false; pending.current = null; if (mounted.current) { setOperation(""); setUploadSlot(null); } }
  async function action(kind: "save" | "preview" | "publish" | "discard") {
    if (!state || !config || locked.current) return;
    if (kind === "publish" && !await confirm({ title: t("publishTitle"), body: t("publishBody"), confirmText: t("publish") })) return;
    if (kind === "discard" && !await confirm({ title: t("discardTitle"), body: t("discardBody"), confirmText: t("discard"), danger: true })) return;
    const controller = begin(kind); if (!controller) return;
    try {
      if (kind === "save") { const result = await saveAppearance(config, state.version, controller.signal); if (!mounted.current) return; setState({ ...state, draft: result.draft, version: result.version }); setConfig(result.draft); toast(t("saved")); }
      if (kind === "preview") { const result = await previewAppearance(controller.signal); if (mounted.current) setPreview(result); }
      if (kind === "publish") { const result = await publishAppearance(state.version, controller.signal); if (!mounted.current) return; setState({ ...state, published: state.draft, publishedRevision: result.published.revision, version: result.version }); toast(t("published")); }
      if (kind === "discard") { const result = await discardAppearance(state.version, controller.signal); if (!mounted.current) return; tasks.current = {}; setUploadErrors({}); setState({ ...state, draft: result.draft, version: result.version }); setConfig(result.draft); toast(t("discarded")); }
    } catch (e) { if (!controller.signal.aborted) report(e); }
    finally { finish(); }
  }
  async function upload(slot: BrandingSlot, file?: File) {
    if (locked.current || !config) return;
    if (file && !validBrandingFile(file, slot)) { setUploadErrors(previous => ({ ...previous, [slot]: "invalid" })); return; }
    if (file) tasks.current[slot] = { file };
    const task = tasks.current[slot]; if (!task) return;
    const controller = begin("upload"); if (!controller) return; setUploadSlot(slot); setProgress(0); setUploadErrors(previous => ({ ...previous, [slot]: undefined }));
    try {
      const asset = await uploadBranding(slot, task, value => { if (mounted.current) setProgress(value); }, controller.signal);
      if (!mounted.current) return;
      setAssets(previous => [...previous.filter(item => item.id !== asset.id), asset]); setConfig(previous => previous ? { ...previous, assets: { ...previous.assets, [slot]: asset.id } } : previous); delete tasks.current[slot];
    } catch (e) { if (!controller.signal.aborted) { if (e instanceof ApiError && e.status === 401) callbacks.current.onExpired(); else setUploadErrors(previous => ({ ...previous, [slot]: message(e) })); } }
    finally { finish(); }
  }
  async function reload() { if (locked.current) return; if ((dirty || queued) && !await confirm({ title: t("discardTitle"), body: t("reloadBody"), confirmText: t("reload"), danger: true })) return; setAttempt(previous => previous + 1); }
  if (loading) return <section className="appearance-workspace"><h1>{t("title")}</h1><div className="appearance-loading admin-skeleton" role="status" aria-label={t("loading")} /><span className="sr-only">{t("loading")}</span></section>;
  if (!state || !config || !themes) return <section className="appearance-workspace"><h1>{t("title")}</h1><p className="admin-error" role="alert">{t(error ?? "failure")}</p><button className="admin-button" onClick={() => void reload()}>{t("retry")}</button></section>;
  return <section className="appearance-workspace" aria-labelledby="appearance-title"><div className="dashboard-heading"><div><p className="admin-eyebrow"><Palette size={16} />Berfumes Black</p><h1 id="appearance-title">{t("title")}</h1><p className="admin-muted">{t("intro")}</p></div><span className={`status-pill ${dirty || queued || unpublished ? "draft" : "published"}`} role="status">{t(dirty || queued ? "unsaved" : unpublished ? "draft" : "live")}</span></div>
    <div className="appearance-notice"><p>{t("unchanged")}</p><span>{t("liveTheme")}: <strong>{t(state.published.themePreset)}</strong></span></div>
    {error && <div className="admin-error" role="alert"><p>{t(error)}</p><button className="admin-button" disabled={busy} onClick={() => void reload()}><RefreshCw size={16} />{t("reload")}</button></div>}
    <ThemeCards value={config.themePreset} published={state.published.themePreset} themes={themes} disabled={busy} onChange={themePreset => setConfig({ ...config, themePreset })} />
    <div className="appearance-section-heading"><h2>{t("images")}</h2><p className="admin-muted">{t("imageHelp")}</p></div>
    <div className="appearance-assets">{brandingSlots.map(slot => <article className="appearance-asset" key={slot}><header><h3>{t(slot)}</h3><span className="status-pill">{t(config.assets[slot] === state.published.assets[slot] ? "publishedLabel" : "draft")}</span></header><div className={`appearance-asset-image asset-${slot}`}><BrandingImage url={brandingUrl(config, assets, slot)} label={t(slot)} expectedImage={!!config.assets[slot]} /></div><div className="appearance-asset-actions"><label className={`admin-button ${busy ? "appearance-upload-disabled" : ""}`}>{config.assets[slot] ? t("replace") : t("upload")}<input type="file" accept={slot === "favicon" ? "image/png" : "image/jpeg,image/png,image/webp"} disabled={busy} aria-label={`${t("replace")}: ${t(slot)}`} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(slot, file); }} /></label><button className="admin-button quiet" disabled={busy || (!config.assets[slot] && !tasks.current[slot])} onClick={() => { delete tasks.current[slot]; setUploadErrors(previous => ({ ...previous, [slot]: undefined })); setConfig({ ...config, assets: { ...config.assets, [slot]: null } }); }}>{t("remove")}</button></div>{uploadSlot === slot && <div className="appearance-upload-status" role="status"><p>{t(progress >= 100 ? "processing" : "uploading")}</p><progress max={100} value={progress} aria-label={t("progress")} /></div>}{uploadErrors[slot] && <div className="appearance-upload-status"><p className="admin-error" role="alert">{t(uploadErrors[slot]!)}</p>{tasks.current[slot] && uploadErrors[slot] !== "expiredUpload" && <button className="admin-button" disabled={busy} onClick={() => void upload(slot)}>{t("uploadRetry")}</button>}</div>}</article>)}</div>
    <p className="admin-muted appearance-image-note">{t("removeHelp")}</p>
    <div className="appearance-actionbar"><p className="admin-muted" role="status">{t(busy ? "working" : queued ? "pendingImages" : dirty ? "saveFirst" : unpublished ? "draft" : "live")}</p><div><button className="admin-button" disabled={busy || (!dirty && !unpublished && !queued)} onClick={() => void action("discard")}><Undo2 size={16} />{t("discard")}</button><button className="admin-button" disabled={busy || dirty || queued} onClick={() => void action("preview")}><Eye size={16} />{t("preview")}</button><button className="admin-button" disabled={busy || !dirty || queued} onClick={() => void action("save")}><Save size={16} />{t("save")}</button><button className="admin-button primary" disabled={busy || dirty || queued || !unpublished} onClick={() => void action("publish")}><Send size={16} />{t("publish")}</button></div></div>
    <AdminDialog open={!!preview} title={t("previewTitle")} onClose={() => setPreview(null)} className="appearance-preview-dialog"><div className="appearance-preview-heading"><div><h2>{t("previewTitle")}</h2><p className="admin-muted">{t("previewHelp")}</p></div><button className="admin-icon-button" aria-label={t("close")} onClick={() => setPreview(null)}><X size={22} /></button></div>{preview && <AppearancePreview appearance={preview} />}</AdminDialog>
  </section>;
}
