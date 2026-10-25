"use client";

import { useState, type FormEvent } from "react";
import { FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { adminApi, ApiError, type Category } from "@/lib/admin-api";
import { useAdminText } from "@/i18n/admin-copy";
import { useAdminUi } from "./admin-ui";

export function CategoryManager({ categories, onChanged, onExpired }: { categories: Category[]; onChanged: () => void; onExpired: () => void }) {
  const t = useAdminText();
  const { confirm, toast } = useAdminUi();
  const [editing, setEditing] = useState<Category | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  function report(error: unknown) {
    if (error instanceof ApiError && error.status === 401) { onExpired(); return; }
    const message = error instanceof Error ? error.message : "Unable to update categories.";
    setError(message); toast(message, true);
    if (error instanceof ApiError) setNameError(error.fields.name?.[0] ?? "");
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget;
    const name = String(new FormData(form).get("name")).trim();
    setBusy(true); setError(""); setNameError("");
    try {
      await adminApi(editing ? `/categories/${editing.id}` : "/categories", { method: editing ? "PUT" : "POST", body: { name } });
      setEditing(null); form.reset(); toast(editing ? "Category updated." : "Category created."); onChanged();
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function remove(category: Category) {
    if (busy || !await confirm({ title: "Delete category?", body: `${category.name}\n${t("This empty category will be permanently removed.")}`, confirmText: "Delete", danger: true })) return;
    setBusy(true); setError("");
    try {
      await adminApi(`/categories/${category.id}`, { method: "DELETE" });
      if (editing?.id === category.id) setEditing(null);
      toast("Category deleted."); onChanged();
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  return <section className="category-manager" aria-labelledby="categories-title">
    <div className="section-heading"><div><h2 id="categories-title">{t("Categories")}</h2><p className="admin-muted">{t("Create and refine the categories behind your fragrances.")}</p></div><span className="count-badge">{categories.length}</span></div>
    {error && <p className="admin-error" role="alert">{t(error)}</p>}
    <form key={editing?.id ?? "new"} onSubmit={save} className="category-form admin-form">
      <label>{t(editing ? "Rename category" : "New category")}<input name="name" required maxLength={120} defaultValue={editing?.name ?? ""} disabled={busy} aria-invalid={!!nameError} aria-describedby={nameError ? "category-name-error" : undefined} />{nameError && <span className="field-error" id="category-name-error">{t(nameError)}</span>}</label>
      <div className="category-form-actions"><button className="admin-button primary" disabled={busy}>{!editing && <Plus size={17} />}{t(busy ? "Saving…" : editing ? "Save name" : "Add category")}</button>{editing && <button type="button" className="admin-button" disabled={busy} onClick={() => { setEditing(null); setNameError(""); setError(""); }}>{t("Cancel")}</button>}</div>
    </form>
    <div className="category-list">{!categories.length && <div className="admin-empty"><FolderOpen size={32} /><h3>{t("Start with a category")}</h3><p>{t("Create your first category, then add a perfume.")}</p></div>}
      {categories.map(category => <div key={category.id} className="category-row"><div><h3>{category.name}</h3><p>{t("Products")} · {category._count.products}</p></div><div className="row-actions"><button type="button" className="admin-button quiet" disabled={busy} onClick={() => { setEditing(category); setError(""); setNameError(""); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".category-form input")?.focus()); }}><Pencil size={16} />{t("Edit")}<span className="sr-only"> {category.name}</span></button><button type="button" className="admin-icon-button" disabled={busy || category._count.products > 0} title={t(category._count.products ? "Move its products before deleting this category." : "Delete")} aria-label={`${t("Delete")} ${category.name}`} onClick={() => void remove(category)}><Trash2 size={17} /></button></div></div>)}
    </div>{categories.some(category => category._count.products > 0) && <p className="admin-fineprint">{t("Move its products before deleting this category.")}</p>}
  </section>;
}
