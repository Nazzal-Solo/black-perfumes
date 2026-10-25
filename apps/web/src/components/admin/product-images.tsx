"use client";

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ImagePlus, LoaderCircle, RefreshCw, Star, Trash2, UploadCloud } from "lucide-react";
import { adminApi, ApiError, type ProductImage } from "@/lib/admin-api";
import { uploadProductImage } from "@/lib/image-upload";
import { MAX_PRODUCT_IMAGES, reconcileImageQueue, uploadImageQueue, validateImageSelection, type QueuedImage } from "@/lib/image-queue";
import { CloudinaryImage } from "./cloudinary-image";
import { useAdminText } from "@/i18n/admin-copy";
import { useAdminUi } from "./admin-ui";

export type ProductImagesHandle = { uploadQueued: (productId: string) => Promise<void> };
export const ProductImages = forwardRef<ProductImagesHandle, {
  productId?: string; productName: string; disabled: boolean; onBusyChange: (busy: boolean) => void;
  onPendingChange: (pending: boolean) => void; onChanged: () => void; onExpired: () => void;
}>(function ProductImages({ productId, productName, disabled, onBusyChange, onPendingChange, onChanged, onExpired }, ref) {
  const t = useAdminText();
  const { confirm, toast } = useAdminUi();
  const [items, setItems] = useState<QueuedImage[]>([]);
  const [loading, setLoading] = useState(!!productId);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [retryOrder, setRetryOrder] = useState(false);
  const current = useRef<QueuedImage[]>([]);
  const locked = useRef(false);
  const mounted = useRef(true);
  const active = useRef<AbortController | null>(null);
  const previews = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const initialProductId = useRef(productId);
  const callbacks = useRef({ onBusyChange, onPendingChange, onChanged, onExpired });
  callbacks.current = { onBusyChange, onPendingChange, onChanged, onExpired };
  const helpId = useId();
  const write = useCallback((next: QueuedImage[]) => {
    if (!mounted.current) return;
    current.current = next; setItems(next);
    callbacks.current.onPendingChange(next.some(item => !item.image));
    const retained = new Set(next.map(item => item.preview));
    for (const preview of previews.current) if (!retained.has(preview)) { URL.revokeObjectURL(preview); previews.current.delete(preview); }
  }, []);
  const report = useCallback((error: unknown) => {
    if (!mounted.current) return;
    if (error instanceof ApiError && error.status === 401) { callbacks.current.onExpired(); return; }
    setError(error instanceof Error ? error.message : "Unable to update images.");
  }, []);
  useEffect(() => {
    mounted.current = true;
    const resources = previews.current;
    return () => { mounted.current = false; active.current?.abort(); for (const preview of resources) URL.revokeObjectURL(preview); resources.clear(); };
  }, []);
  useEffect(() => {
    // A newly created product already has its local queue; do not race the automatic upload with an initial reload.
    if (!productId || productId !== initialProductId.current) return;
    const controller = new AbortController();
    adminApi<{ images: ProductImage[] }>(`/products/${productId}/images`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) write(reconcileImageQueue(current.current, result.images)); })
      .catch(error => { if (!controller.signal.aborted) report(error); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId, report, write]);
  function start() {
    if (locked.current) return false;
    locked.current = true; setBusy(true); callbacks.current.onBusyChange(true); setError(""); return true;
  }
  function finish() {
    locked.current = false;
    if (mounted.current) { setBusy(false); callbacks.current.onBusyChange(false); }
  }
  async function refresh() {
    if (!productId || disabled || !start()) return;
    setLoading(true);
    try { const result = await adminApi<{ images: ProductImage[] }>(`/products/${productId}/images`); write(reconcileImageQueue(current.current, result.images)); callbacks.current.onChanged(); }
    catch (error) { report(error); }
    finally { if (mounted.current) setLoading(false); finish(); }
  }
  async function run(id: string, ids?: Set<string>) {
    if (!start()) return;
    const controller = new AbortController(); active.current = controller;
    try {
      await uploadImageQueue({ getItems: () => current.current, setItems: write, changed: () => callbacks.current.onChanged(), ids,
        transport: {
          list: async () => (await adminApi<{ images: ProductImage[] }>(`/products/${id}/images`, { signal: controller.signal })).images,
          issue: async file => (await adminApi<{ ticket: string }>(`/products/${id}/images/signature`, { method: "POST", body: { size: file.size, contentType: file.type }, signal: controller.signal })).ticket,
          upload: async (file, ticket, progress) => (await uploadProductImage(id, file, ticket, progress, controller.signal)).images,
          reorder: async imageIds => (await adminApi<{ images: ProductImage[] }>(`/products/${id}/images/order`, { method: "PUT", body: { imageIds }, signal: controller.signal })).images,
        },
      });
      if (mounted.current) setRetryOrder(false);
    } catch (error) { if (!controller.signal.aborted) { report(error); setRetryOrder(true); } }
    finally {
      active.current = null;
      // A lost response can still represent a committed attachment; refresh the parent preview on close.
      if (mounted.current) callbacks.current.onChanged();
      finish();
    }
  }
  useImperativeHandle(ref, () => ({ uploadQueued: id => run(id) }));
  function select(files: File[]) {
    if (disabled || locked.current || loading || !files.length) return;
    const validation = validateImageSelection(files, current.current.length);
    if (validation) { setError(validation); return; }
    setError("");
    const queued = files.map(file => { const preview = URL.createObjectURL(file); previews.current.add(preview); return { id: crypto.randomUUID(), file, preview, progress: 0, status: "Waiting" as const }; });
    write([...current.current, ...queued]);
    if (productId) void run(productId, new Set(queued.map(item => item.id)));
  }
  async function reorder(index: number, target: number) {
    if (disabled || locked.current || loading) return;
    const previous = current.current;
    const ordered = [...previous];
    const item = ordered.splice(index, 1)[0]; if (!item) return;
    ordered.splice(target, 0, item);
    if (!productId) { write(ordered); return; }
    if (!start()) return;
    try {
      const imageIds = ordered.flatMap(item => item.image ? [item.image.id] : []);
      const result = await adminApi<{ images: ProductImage[] }>(`/products/${productId}/images/order`, { method: "PUT", body: { imageIds } });
      write(reconcileImageQueue(ordered, result.images)); toast("Image order saved."); callbacks.current.onChanged();
    } catch (error) { report(error); }
    finally { finish(); }
  }
  async function remove(item: QueuedImage) {
    if (disabled || locked.current || loading) return;
    if (!item.image) { write(current.current.filter(value => value.id !== item.id)); return; }
    if (!await confirm({ title: "Remove image?", body: "Remove this image from the product?", confirmText: "Remove", danger: true }) || !start()) return;
    try {
      const result = await adminApi<{ images: ProductImage[] }>(`/products/${productId}/images/${item.image.id}`, { method: "DELETE" });
      write(reconcileImageQueue(current.current.filter(value => value.id !== item.id), result.images)); toast("Image removed."); callbacks.current.onChanged();
    } catch (error) { report(error); }
    finally { finish(); }
  }
  const blocked = disabled || busy || loading;
  const pending = items.some(item => !item.image);
  return <section className="product-images" onDragOver={event => event.preventDefault()} onDrop={event => event.preventDefault()} aria-labelledby={`${helpId}-title`} aria-busy={busy || loading}>
    <div className="image-section-heading"><h3 id={`${helpId}-title`}>{t("Product images")}</h3><span className="count-badge">{items.length} / {MAX_PRODUCT_IMAGES}</span></div>
    <p id={helpId} className="admin-muted">{t("The first image is your primary image. JPEG, PNG, or WebP · up to 10 MB each.")}</p>
    <p className="image-save-hint">{t(productId ? "Image changes are saved immediately." : "Images stay on your device until you create the product.")}</p>
    {error && <div className="admin-error" role="alert">{t(error)}{productId && <button type="button" className="inline-retry" disabled={blocked} onClick={() => void refresh()}>{t("Refresh images")}</button>}</div>}
    <input ref={input} type="file" hidden tabIndex={-1} accept="image/jpeg,image/png,image/webp" multiple disabled={blocked || items.length >= MAX_PRODUCT_IMAGES} onChange={event => { event.stopPropagation(); const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; select(files); }} />
    <button type="button" className={`image-dropzone ${dragging ? "dragging" : ""}`} disabled={blocked || items.length >= MAX_PRODUCT_IMAGES} aria-describedby={helpId} onClick={() => input.current?.click()}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = blocked ? "none" : "copy"; if (!blocked) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); select(Array.from(event.dataTransfer.files)); }}>
      <span className="dropzone-symbol">{busy ? <LoaderCircle className="upload-spinner" size={27} /> : <UploadCloud size={27} />}</span>
      <strong>{t(busy ? "Uploading images…" : dragging ? "Drop images here" : "Drop images here or click to browse")}</strong><span>{t("JPEG, PNG or WebP · 10 MB per image · up to 10 images")}</span><span className="dropzone-browse"><ImagePlus size={16} />{t("Browse images")}</span>
    </button>
    {productId && (pending || retryOrder) && <div className="queue-toolbar"><p className="admin-muted" role="status">{t(busy ? "Uploading images…" : "Your product is saved. Retry pending images without creating it again.")}</p><button type="button" className="admin-button" disabled={blocked} onClick={() => void run(productId)}><RefreshCw size={16} />{t("Retry uploads")}</button></div>}
    {loading ? <p role="status" className="admin-loading">{t("Loading images…")}</p> : <div className="image-grid">
      {/* Local blob previews are already client-side and must bypass remote image optimization. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {items.map((item, index) => <article key={item.id} className="image-card"><div className="image-card-preview">{item.image ? <CloudinaryImage url={item.image.url} alt={item.image.altText || productName} sizes="(max-width: 639px) 42vw, 230px" /> : <img src={item.preview} alt={item.file?.name ?? productName} width={240} height={240} />}{index === 0 && <span className="image-primary"><Star size={12} />{t("Primary")}</span>}<span className={`image-queue-status ${item.image ? "saved" : ""}`}>{item.image ? <Check size={13} /> : null}{t(item.status)}</span></div>
        {!item.image && <div className="image-upload-status" aria-live="polite"><p title={item.file?.name}>{item.file?.name}</p>{["Uploading", "Processing"].includes(item.status) && <><progress value={item.progress} max={100} aria-label={`${t("Upload progress")} ${item.file?.name ?? ""}`} /><span>{item.progress}% · {t(item.status)}</span></>}{item.error && <p className="field-error" role="alert">{t(item.error)}</p>}</div>}
        <div className="image-card-actions"><span className="image-number">{index + 1}</span><button type="button" className="admin-button quiet" disabled={blocked || index === 0} aria-label={`${t("Move earlier")} ${index + 1}`} onClick={() => void reorder(index, index - 1)}><ArrowLeft size={16} className="directional-icon" /></button><button type="button" className="admin-button quiet" disabled={blocked || index === items.length - 1} aria-label={`${t("Move later")} ${index + 1}`} onClick={() => void reorder(index, index + 1)}><ArrowRight size={16} className="directional-icon" /></button><button type="button" className="admin-button quiet image-set-primary" disabled={blocked || index === 0} onClick={() => void reorder(index, 0)}>{t(index === 0 ? "Primary image" : "Set primary")}</button><button type="button" className="admin-button danger image-remove" disabled={blocked} aria-label={`${t("Remove")} ${index + 1}`} onClick={() => void remove(item)}><Trash2 size={14} />{t("Remove")}</button></div>
      </article>)}
    </div>}
    {!loading && !items.length && <p className="images-empty admin-muted">{t("Choose a few images to bring this perfume to life.")}</p>}
  </section>;
});
