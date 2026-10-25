"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import { X, SlidersHorizontal, ImageIcon, NotebookPen, Wallet } from "lucide-react";
import { adminApi, ApiError, type Category, type Product } from "@/lib/admin-api";
import { formFingerprint, productPayload } from "@/lib/admin-view";
import { useAdminText } from "@/i18n/admin-copy";
import { useAdminUi } from "./admin-ui";
import { ProductIdentityFields } from "./product-identity-fields";
import { ProductImages, type ProductImagesHandle } from "./product-images";

const tabs = [{ name: "Basics", icon: NotebookPen }, { name: "Pricing & availability", icon: Wallet }, { name: "Images", icon: ImageIcon }, { name: "Advanced & verification", icon: SlidersHorizontal }];
export type ProductFormHandle = { requestClose: () => void };
export const ProductForm = forwardRef<ProductFormHandle, { product: Product | null; categories: Category[]; onSaved: (product: Product) => void; onCancel: () => void; onExpired: () => void; onImagesChanged: () => void }>(function ProductForm({ product, categories, onSaved, onCancel, onExpired, onImagesChanged }, ref) {
  const t = useAdminText();
  const { toast, confirm } = useAdminUi();
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingImages, setPendingImages] = useState(false);
  const [creationUncertain, setCreationUncertain] = useState(false);
  const imageEditor = useRef<ProductImagesHandle>(null);
  const savedProduct = useRef(product);
  const submitting = useRef(false);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const form = useRef<HTMLFormElement>(null);
  const baseline = useRef("");
  const closing = useRef(false);
  useEffect(() => { if (form.current) baseline.current = formFingerprint(new FormData(form.current)); }, []);
  useEffect(() => {
    if (!dirty && !pendingImages && !imageBusy && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, pendingImages, imageBusy, busy]);
  const requestClose = useCallback(async () => {
    if (closing.current) return;
    if (busy || imageBusy) { toast("Finish the current save or upload before closing."); return; }
    closing.current = true;
    if ((!dirty && !pendingImages) || await confirm({ title: "Unsaved changes", body: "Discard unsaved fields and queued images? Product details and images already saved will remain.", confirmText: "Discard changes", danger: true })) onCancel();
    closing.current = false;
  }, [busy, imageBusy, dirty, pendingImages, toast, confirm, onCancel]);
  useImperativeHandle(ref, () => ({ requestClose: () => void requestClose() }), [requestClose]);
  function showField(name: string) {
    const input = form.current?.elements.namedItem(name);
    if (!(input instanceof HTMLElement)) return;
    const panel = input.closest<HTMLElement>("[data-panel]");
    setTab(Number(panel?.dataset.panel ?? 0));
    requestAnimationFrame(() => { input.focus(); if (input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement) input.reportValidity(); });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || imageBusy || creationUncertain) return;
    const invalid = form.current?.querySelector<HTMLInputElement>(":invalid");
    if (invalid) { showField(invalid.name); return; }
    const data = new FormData(event.currentTarget);
    const target = savedProduct.current ?? product;
    const creating = !target;
    let acknowledged = false;
    submitting.current = true; setBusy(true); setError(""); setFields({});
    try {
      const result = await adminApi<{ product: Product }>(target ? `/products/${target.id}` : "/products", { method: target ? "PUT" : "POST", body: productPayload(data) });
      acknowledged = true; savedProduct.current = result.product;
      if (form.current) {
        for (const name of ["isVisible", "isArchived", "referenceVerified"] as const) {
          const input = form.current.elements.namedItem(name);
          if (input instanceof HTMLInputElement) input.checked = result.product[name];
        }
        // Read while fields are disabled using the captured data, including server-normalized flags.
        for (const name of ["isVisible", "isArchived", "referenceVerified"] as const) {
          if (result.product[name]) data.set(name, "on"); else data.delete(name);
        }
      }
      baseline.current = formFingerprint(data); setDirty(false);
      onSaved(result.product);
      toast(creating ? "Product created." : "Changes saved.");
      if (creating && pendingImages) { setTab(2); await imageEditor.current?.uploadQueued(result.product.id); }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { onExpired(); return; }
      const uncertain = creating && !acknowledged && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500);
      if (uncertain) setCreationUncertain(true);
      const message = uncertain ? "Product creation could not be confirmed. Check the catalog before creating again to avoid duplicates." : error instanceof Error ? error.message : "Unable to save product.";
      setError(message); toast(message, true);
      if (error instanceof ApiError) { setFields(error.fields); const name = Object.keys(error.fields)[0]; if (name) showField(name); }
    } finally { submitting.current = false; setBusy(false); }
  }
  const fieldError = (name: string) => fields[name]?.[0] ? <span className="field-error">{fields[name]![0]}</span> : null;
  return <div className="admin-editor">
    <header className="editor-heading"><div><p className="admin-eyebrow">{t("Catalog")}</p><h2>{t(product ? "Edit product" : "New product")}</h2></div><button type="button" className="admin-icon-button" aria-label={t("Close")} onClick={() => void requestClose()}><X size={22} /></button></header>
    <div className="editor-tabs" role="tablist" aria-label={t("Edit product")}>{tabs.map(({ name, icon: Icon }, index) => <button type="button" key={name} role="tab" id={`editor-tab-${index}`} aria-controls={`editor-panel-${index}`} aria-selected={tab === index} tabIndex={tab === index ? 0 : -1} onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const rtl = event.currentTarget.closest("[dir]")?.getAttribute("dir") === "rtl"; const direction = event.key === "ArrowRight" ? (rtl ? -1 : 1) : (rtl ? 1 : -1); const next = event.key === "Home" ? 0 : event.key === "End" ? 3 : (index + direction + 4) % 4; setTab(next); document.getElementById(`editor-tab-${next}`)?.focus(); } }} onClick={() => setTab(index)}><Icon size={17} /><span>{t(name)}</span></button>)}</div>
    <form ref={form} onSubmit={submit} noValidate className="admin-form editor-form" onChange={() => { if (form.current) setDirty(formFingerprint(new FormData(form.current)) !== baseline.current); }}>
      <div className="editor-scroll">{error && <div className="admin-error" role="alert"><p>{t(error)}</p>{Object.entries(fields).map(([name, messages]) => <button key={name} type="button" className="inline-retry" onClick={() => showField(name)}>{t(messages[0] ?? "Check the product details.")}</button>)}</div>}
        <fieldset disabled={busy || imageBusy}>
          <section id="editor-panel-0" role="tabpanel" aria-labelledby="editor-tab-0" data-panel="0" hidden={tab !== 0} className="editor-panel">
            <div className="form-columns"><label>{t("Product name")}<input autoFocus name="name" required maxLength={200} defaultValue={product?.name ?? ""} aria-invalid={!!fields.name} />{fieldError("name")}</label><label>{t("Category")}<select name="categoryId" required defaultValue={product?.categoryId ?? ""} aria-invalid={!!fields.categoryId}><option value="" disabled>{t("Select a category")}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{fieldError("categoryId")}</label></div>
            <div className="form-columns"><label>{t("Custom display name")}<input name="customDisplayName" maxLength={200} defaultValue={product?.customDisplayName ?? ""} /></label><label>{t("Arabic display name")}<input name="nameAr" dir="rtl" maxLength={200} defaultValue={product?.nameAr ?? ""} /></label></div>
            <label>{t("Description")}<textarea name="description" rows={4} maxLength={5000} defaultValue={product?.description ?? ""} aria-invalid={!!fields.description} />{fieldError("description")}</label>
            <label>{t("Arabic description")}<textarea name="descriptionAr" rows={4} dir="rtl" maxLength={5000} defaultValue={product?.descriptionAr ?? ""} /></label>
            <label className="visibility-choice"><input type="checkbox" name="isVisible" defaultChecked={product?.isVisible ?? false} /><span>{t("Publish in the collection")}<small>{t("Verify the reference in Advanced before publishing.")}</small></span></label>
            <p className="admin-fineprint">{t("Leave unknown details blank. Publishing a reference does not confirm inventory.")}</p>
          </section>
          <section id="editor-panel-1" role="tabpanel" aria-labelledby="editor-tab-1" data-panel="1" hidden={tab !== 1} className="editor-panel">
            <p className="admin-muted">{t("Leave unknown details blank. Publishing a reference does not confirm inventory.")}</p>
            <div className="form-columns"><label>{t("Price · JOD")}<input name="priceJod" type="number" inputMode="decimal" min="0" max="9999999.999" step="0.001" defaultValue={product?.priceJod ?? ""} placeholder={t("Unknown — leave blank")} aria-invalid={!!fields.priceJod} />{fieldError("priceJod")}</label><label>{t("Confirmed availability")}<select name="availability" defaultValue={product?.availability ?? ""}><option value="">{t("Not confirmed")}</option><option value="AVAILABLE">{t("Available")}</option><option value="UNAVAILABLE">{t("Unavailable")}</option></select></label><label>{t("Size · ml")}<input name="sizeMl" type="number" min="0" max="999999.99" step="0.01" defaultValue={product?.sizeMl ?? ""} placeholder={t("Unknown — leave blank")} /></label><label>{t("Concentration")}<input name="concentration" maxLength={120} defaultValue={product?.concentration ?? ""} /></label></div>
          </section>
          <section id="editor-panel-3" role="tabpanel" aria-labelledby="editor-tab-3" data-panel="3" hidden={tab !== 3} className="editor-panel"><ProductIdentityFields product={product} /></section>
        </fieldset>
        <section id="editor-panel-2" role="tabpanel" aria-labelledby="editor-tab-2" data-panel="2" hidden={tab !== 2} className="editor-panel"><ProductImages ref={imageEditor} productId={product?.id} productName={product?.name ?? ""} disabled={busy || creationUncertain} onBusyChange={setImageBusy} onPendingChange={setPendingImages} onChanged={onImagesChanged} onExpired={onExpired} /></section>
      </div>
      <footer className="editor-footer"><span className="admin-muted">{dirty || pendingImages ? t("Unsaved changes") : t("Leave unknown details blank. Publishing a reference does not confirm inventory.")}</span><div className="editor-actions"><button type="button" className="admin-button" onClick={() => void requestClose()}>{t("Cancel")}</button><button type="submit" className="admin-button primary" disabled={busy || imageBusy || creationUncertain}>{t(busy ? "Saving…" : product ? "Save changes" : "Create product")}</button></div></footer>
    </form>
  </div>;
});
