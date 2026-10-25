"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, X, TriangleAlert } from "lucide-react";
import { createPortal } from "react-dom";
import { useAdminText } from "@/i18n/admin-copy";

let openDialogs = 0;
let previousOverflow = "";

export function AdminDialog({ open, title, onClose, children, className = "" }: { open: boolean; title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    const focus = document.activeElement as HTMLElement | null;
    dialog.showModal();
    if (openDialogs++ === 0) previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); if (--openDialogs === 0) document.body.style.overflow = previousOverflow; if (focus?.isConnected) focus.focus(); };
  }, [open]);
  return <dialog ref={ref} aria-label={title} className={`admin-dialog ${className}`} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose(); } }}>{children}</dialog>;
}
type Confirmation = { title: string; body: string; confirmText?: string; danger?: boolean };
type Ui = { toast: (message: string, error?: boolean) => void; confirm: (options: Confirmation) => Promise<boolean> };
const Context = createContext<Ui | null>(null);
export const useAdminUi = () => { const value = useContext(Context); if (!value) throw new Error("Admin UI provider missing"); return value; };
export function AdminUiProvider({ children }: { children: ReactNode }) {
  const t = useAdminText();
  const [notification, setNotification] = useState<{ message: string; error: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [toastTarget, setToastTarget] = useState<HTMLElement | null>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const id = useId();
  const toast = useCallback((message: string, error = false) => setNotification({ message, error }), []);
  const confirm = useCallback((options: Confirmation) => new Promise<boolean>(done => { resolve.current?.(false); resolve.current = done; setConfirmation(options); }), []);
  const finish = (value: boolean) => { resolve.current?.(value); resolve.current = null; setConfirmation(null); };
  useEffect(() => { if (!notification) return; const timeout = setTimeout(() => setNotification(null), 6000); return () => clearTimeout(timeout); }, [notification]);
  useEffect(() => {
    const sync = () => { const dialogs = document.querySelectorAll<HTMLDialogElement>(".admin-dialog[open]"); setToastTarget(dialogs.item(dialogs.length - 1)); };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { attributes: true, attributeFilter: ["open"], childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  const notificationView = notification && <div className={`admin-toast ${notification.error ? "error" : ""}`} role={notification.error ? "alert" : "status"}>{notification.error ? <TriangleAlert size={20} /> : <CheckCircle2 size={20} />}<span>{t(notification.message)}</span><button type="button" className="admin-icon-button" aria-label={t("Dismiss notification")} onClick={() => setNotification(null)}><X size={18} /></button></div>;
  return <Context.Provider value={{ toast, confirm }}>{children}
    {toastTarget ? createPortal(notificationView, toastTarget) : notificationView}
    <AdminDialog open={!!confirmation} title={t(confirmation?.title ?? "Confirm")} onClose={() => finish(false)} className="admin-confirm">
      <div className="confirm-symbol"><TriangleAlert size={24} /></div><h2 id={id}>{t(confirmation?.title ?? "Confirm")}</h2><p>{t(confirmation?.body ?? "")}</p><div className="editor-actions"><button autoFocus className="admin-button" onClick={() => finish(false)}>{t("Cancel")}</button><button className={`admin-button ${confirmation?.danger ? "danger" : "primary"}`} onClick={() => finish(true)}>{t(confirmation?.confirmText ?? "Confirm")}</button></div>
    </AdminDialog>
  </Context.Provider>;
}
