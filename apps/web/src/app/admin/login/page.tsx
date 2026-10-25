"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAdminText } from "@/i18n/admin-copy";
import { LanguageSwitcher } from "@/components/public-locale";
import { adminApi, ApiError, type AdminSession } from "@/lib/admin-api";

export default function AdminLogin() {
  const router = useRouter();
  const t = useAdminText();
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    adminApi<AdminSession>("/session", { signal: controller.signal }).then(() => router.replace("/admin")).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      if (new URLSearchParams(window.location.search).has("expired")) setNotice("Your session has ended. Sign in to continue.");
      if (!(error instanceof ApiError) || error.status !== 401) setError(error instanceof Error ? error.message : "Unable to check your session.");
      setChecking(false);
    });
    return () => controller.abort();
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const form = event.currentTarget;
    setBusy(true); setError("");
    try {
      await adminApi<AdminSession>("/login", { method: "POST", body: { email: String(data.get("email")).trim(), password: String(data.get("password")) } });
      await adminApi<AdminSession>("/session");
      form.reset();
      router.replace("/admin");
    } catch (error) {
      setError(error instanceof ApiError && error.status === 401 ? "Sign-in failed. Check your details and ensure cookies are allowed." : error instanceof Error ? error.message : "Unable to sign in.");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="admin-login">
      <section className="login-story" aria-label="Black Perfumes administration">
        <Link href="/" className="admin-wordmark">BLACK <span>PERFUMES</span></Link>
        <div><p className="admin-eyebrow">{t("The private collection")}</p><h1>{t("Considered scents.")}<br /><em>{t("Carefully curated.")}</em></h1><p className="login-description">{t("A quiet space to shape the Black Perfumes collection.")}</p></div>
        <p className="admin-fineprint">{t("Private workspace")}</p>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap"><LanguageSwitcher />
          <p className="admin-eyebrow">{t("Private access")}</p><h2>{t("Welcome back.")}</h2><p className="admin-muted">{t("Sign in to manage your collection.")}</p>
          {checking ? <p role="status" className="admin-notice">{t("Checking your session…")}</p> : <>
            {notice && <p className="admin-notice" role="status">{t(notice)}</p>}
            {error && <p className="admin-error" role="alert">{t(error)}</p>}
            <form onSubmit={submit} className="admin-form">
              <label>{t("Email address")}<input name="email" type="email" autoComplete="username" required maxLength={254} placeholder="you@example.com" disabled={busy} /></label>
              <label>{t("Password")}<input name="password" type="password" autoComplete="current-password" required maxLength={128} disabled={busy} /></label>
              <button className="admin-button primary" disabled={busy}>{t(busy ? "Signing in…" : "Sign in")}</button>
            </form>
          </>}
          <p className="admin-fineprint login-private">{t("Private access")}</p>
        </div>
      </section>
    </main>
  );
}
