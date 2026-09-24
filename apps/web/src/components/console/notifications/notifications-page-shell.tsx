"use client";

import React, { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { useRouter } from "next/navigation";
import { Bell, RefreshCw, AlertCircle, CheckCircle, Save, Send, Mail, Globe, Eye, EyeOff } from "lucide-react";
import { api } from "@/services/api-client";
import { getStoredToken, getStoredUser, getStoredTenantId, type NavUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { Dialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/PageHeader";
import { ConsolePage } from "@/components/ui/console-page";
import { TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

const inputCls = "nf-input";
const inputStyle = {
  borderColor: "var(--input-border)",
  backgroundColor: "var(--input-bg)",
  color: "var(--input-text)",
};

export type NotificationChannel = "EMAIL" | "WEBHOOK";

const CHANNEL_ROUTES: Record<NotificationChannel, string> = {
  EMAIL: "/notifications/email",
  WEBHOOK: "/notifications/webhook",
};

export function NotificationsPageShell({ activeChannel }: { activeChannel: NotificationChannel }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [activeCompany, setActiveCompany] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [emailForm, setEmailForm] = useState({
    smtp_host: "", smtp_port: 587, smtp_user: "", smtp_password: "",
    from_email: "", from_name: "NAVFarm Alerts",
  });
  const [webhookForm, setWebhookForm] = useState({ webhook_url: "", webhook_secret: "" });
  const [testRecipient, setTestRecipient] = useState("");
  const [testMessage, setTestMessage] = useState("This is a live test notification from your NAVFarm workspace.");

  const [configs, setConfigs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    const token = getStoredToken();
    const storedUser = getStoredUser();
    const tid = getStoredTenantId();
    if (!token || !storedUser || !tid) { router.replace("/"); return; }
    loadData(storedUser, tid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const loadData = async (storedUser: NavUser, tid: string) => {
    setLoading(true);
    setError("");
    try {
      const companiesList = await api.get(`/company/tenant/${tid}`);
      const myId = storedUser.companyId || (storedUser as any).company_id;
      const myCompany = companiesList.find((c: any) => c.company_id === myId) || companiesList[0];
      setActiveCompany(myCompany || null);

      if (myCompany?.company_id) {
        const [configs, logsList] = await Promise.all([
          api.get(`/notification/company/${myCompany.company_id}`).catch(() => []),
          api.get(`/notification/logs/${myCompany.company_id}`).catch(() => [])
        ]);
        setConfigs(Array.isArray(configs) ? configs : []);
        setLogs(Array.isArray(logsList) ? logsList.reverse() : []);

        const emailCfg = configs?.find((c: any) => c.channel === "EMAIL");
        const webhookCfg = configs?.find((c: any) => c.channel === "WEBHOOK");
        // smtp_password / webhook_secret are never returned by the API once saved (encrypted
        // at rest, write-only from here) — leave blank; submitting blank keeps the existing
        // secret, typing a new value replaces it. *_configured tells the UI whether one is set.
        if (emailCfg) setEmailForm({
          smtp_host: emailCfg.smtp_host || "", smtp_port: emailCfg.smtp_port || 587,
          smtp_user: emailCfg.smtp_user || "", smtp_password: "",
          from_email: emailCfg.from_email || "", from_name: emailCfg.from_name || "NAVFarm Alerts",
        });
        if (webhookCfg) setWebhookForm({
          webhook_url: webhookCfg.webhook_url || "", webhook_secret: "",
        });
      }
    } catch (e: any) {
      setError(e?.message || t("ntLoadFailedDefault"));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      // Omit smtp_password entirely when left blank, so re-saving other fields
      // never wipes an already-configured secret the server won't echo back.
      const { smtp_password, ...emailFormRest } = emailForm;
      const payload = smtp_password ? { ...emailFormRest, smtp_password } : emailFormRest;

      const existing = configs.find((config) => config.channel === "EMAIL");
      if (existing) {
        const updated = await api.put(`/notification/${existing.notif_id}`, payload);
        setConfigs((current) => current.map((c) => (c.notif_id === updated.notif_id ? updated : c)));
      } else {
        const created = await api.post("/notification", { company_id: activeCompany.company_id, channel: "EMAIL", ...payload });
        setConfigs((current) => [...current, created]);
      }
      setEmailForm((f) => ({ ...f, smtp_password: "" }));
      setSuccess(t("ntSaveEmailSuccess"));
    } catch (err: any) { setError(err?.message || t("ntSaveFailedDefault")); }
    finally { setSaving(false); }
  };

  const handleSaveWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const { webhook_secret, ...webhookFormRest } = webhookForm;
      const payload = webhook_secret ? { ...webhookFormRest, webhook_secret } : webhookFormRest;

      const existing = configs.find((config) => config.channel === "WEBHOOK");
      if (existing) {
        const updated = await api.put(`/notification/${existing.notif_id}`, payload);
        setConfigs((current) => current.map((c) => (c.notif_id === updated.notif_id ? updated : c)));
      } else {
        const created = await api.post("/notification", { company_id: activeCompany.company_id, channel: "WEBHOOK", ...payload });
        setConfigs((current) => [...current, created]);
      }
      setWebhookForm((f) => ({ ...f, webhook_secret: "" }));
      setSuccess(t("ntSaveWebhookSuccess"));
    } catch (err: any) { setError(err?.message || t("ntSaveFailedDefault")); }
    finally { setSaving(false); }
  };

  const handleTestSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompany || !testRecipient) return;
    setTesting(true); setError(""); setSuccess("");
    try {
      // Find the email config to get the correct configId
      const configs = await api.get(`/notification/company/${activeCompany.company_id}`).catch(() => []);
      const emailCfg = configs?.find((c: any) => c.channel === "EMAIL");
      if (!emailCfg) {
        throw new Error(t("ntConfigureSmtpFirst"));
      }

      await api.post("/notification/test", { configId: emailCfg.notif_id, recipient: testRecipient, message: testMessage });
      setSuccess(t("ntTestSentSuccess"));
      setShowTestDialog(false);

      // Reload logs
      const updatedLogs = await api.get(`/notification/logs/${activeCompany.company_id}`).catch(() => []);
      setLogs(Array.isArray(updatedLogs) ? updatedLogs.reverse() : []);
    } catch (err: any) { setError(err?.message || t("ntTestSendFailedDefault")); }
    finally { setTesting(false); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin w-5 h-5 mr-2" style={{ color: "var(--accent)" }} />
        <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("ntLoading")}</span>
      </div>
    );
  }

  const tabCls = (tab: NotificationChannel) => `px-5 py-2.5 text-sm font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
    activeChannel === tab
      ? "border-[var(--accent)]"
      : "border-transparent"
  }`;

  return (
    <ConsolePage>
      <PageHeader
        title={t("ntTitle")}
        description={
          <>
            {t("ntDescPrefix")}{" "}
            <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{activeCompany?.company_name || "—"}</span>
          </>
        }
      />

      {error && (
        <div
          className="flex items-center gap-2 rounded-[var(--radius-sm)] border p-4 text-sm font-medium"
          style={{ backgroundColor: "var(--danger-muted)", borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div
          className="flex items-center gap-2 rounded-[var(--radius-sm)] border p-4 text-sm font-medium"
          style={{ backgroundColor: "var(--success-muted)", borderColor: "var(--success)", color: "var(--success)" }}
        >
          <CheckCircle className="w-4 h-4 shrink-0" /> {success}
        </div>
      )}

      {/* Channel Tabs */}
      <div className="rounded-lg border" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex border-b px-2" style={{ borderColor: "var(--border)" }}>
          <button onClick={() => router.push(CHANNEL_ROUTES.EMAIL)}
            className={tabCls("EMAIL")}
            style={{ color: activeChannel === "EMAIL" ? "var(--accent)" : "var(--text-secondary)" }}>
            <Mail className="w-4 h-4" /> {t("ntTabEmail")}
          </button>
          <button onClick={() => router.push(CHANNEL_ROUTES.WEBHOOK)}
            className={tabCls("WEBHOOK")}
            style={{ color: activeChannel === "WEBHOOK" ? "var(--accent)" : "var(--text-secondary)" }}>
            <Globe className="w-4 h-4" /> {t("ntTabWebhook")}
          </button>
        </div>

        <div className="p-6">
          {activeChannel === "EMAIL" && (
            <form onSubmit={handleSaveEmail} className="space-y-5">
              <h2 className="nf-text-label-strong" style={{ color: "var(--text-primary)" }}>{t("ntSmtpConfig")}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label={t("ntSmtpHost")}>
                  <input value={emailForm.smtp_host} onChange={(e) => setEmailForm({ ...emailForm, smtp_host: e.target.value })}
                    placeholder={t("ntPhSmtpHost")} className={inputCls} style={inputStyle} />
                </Field>
                <Field label={t("ntSmtpPort")}>
                  <input type="number" value={emailForm.smtp_port} onChange={(e) => setEmailForm({ ...emailForm, smtp_port: +e.target.value })}
                    className={inputCls} style={inputStyle} />
                </Field>
                <Field label={t("ntSmtpUser")}>
                  <input value={emailForm.smtp_user} onChange={(e) => setEmailForm({ ...emailForm, smtp_user: e.target.value })}
                    placeholder={t("ntPhSmtpUser")} className={inputCls} style={inputStyle} />
                </Field>
                <Field label={`${t("ntAppPassword")}${configs.find((c) => c.channel === "EMAIL")?.smtp_password_configured ? t("ntAppPasswordConfigured") : ""}`}>
                  <div className="relative">
                    <input type={showPassword ? "text" : "password"}
                      value={emailForm.smtp_password}
                      onChange={(e) => setEmailForm({ ...emailForm, smtp_password: e.target.value })}
                      placeholder={t("ntPhSmtpPassword")} className={`${inputCls} pr-10`} style={inputStyle} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </Field>
                <Field label={t("ntFromEmail")}>
                  <input type="email" value={emailForm.from_email}
                    onChange={(e) => setEmailForm({ ...emailForm, from_email: e.target.value })}
                    placeholder={t("ntPhFromEmail")} className={inputCls} style={inputStyle} />
                </Field>
                <Field label={t("ntFromName")}>
                  <input value={emailForm.from_name} onChange={(e) => setEmailForm({ ...emailForm, from_name: e.target.value })}
                    placeholder={t("ntPhFromName")} className={inputCls} style={inputStyle} />
                </Field>
              </div>
              <div className="flex gap-3 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "var(--accent)" }}>
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? t("saving") : t("ntSaveEmailConfig")}
                </button>
              </div>
            </form>
          )}

          {activeChannel === "WEBHOOK" && (
            <form onSubmit={handleSaveWebhook} className="space-y-5">
              <h2 className="nf-text-label-strong" style={{ color: "var(--text-primary)" }}>{t("ntWebhookConfig")}</h2>
              <div className="space-y-4">
                <Field label={t("ntWebhookUrl")}>
                  <input type="url" value={webhookForm.webhook_url}
                    onChange={(e) => setWebhookForm({ ...webhookForm, webhook_url: e.target.value })}
                    placeholder="https://hooks.slack.com/services/…" className={inputCls} style={inputStyle} />
                </Field>
                <Field label={`${t("ntSecretKeyOptional")}${configs.find((c) => c.channel === "WEBHOOK")?.webhook_secret_configured ? t("ntSecretConfigured") : ""}`}>
                  <input value={webhookForm.webhook_secret}
                    onChange={(e) => setWebhookForm({ ...webhookForm, webhook_secret: e.target.value })}
                    placeholder={t("ntPhSigningSecret")} className={inputCls} style={inputStyle} />
                </Field>
              </div>
              <div className="flex gap-3 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 text-white text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: "var(--accent)" }}>
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {saving ? t("saving") : t("ntSaveWebhookConfig")}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Test Send */}
      <div
        className="flex flex-col gap-4 rounded-[var(--radius-md)] border p-5 sm:flex-row sm:items-center sm:justify-between"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="rounded-[var(--radius-sm)] p-2"
            style={{ backgroundColor: "var(--surface-raised)", color: "var(--info)" }}
          >
            <Send className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{t("ntTestSetupTitle")}</h2>
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("ntTestSetupDesc")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowTestDialog(true)}
          className="nf-press inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: "var(--accent)" }}
        >
          <Send className="h-4 w-4" /> {t("ntSendTest")}
        </button>
      </div>

      <Dialog
        open={showTestDialog}
        onClose={() => !testing && setShowTestDialog(false)}
        title={t("ntSendTestNotifTitle")}
        description={t("ntSendTestNotifDesc")}
        maxWidth="md"
      >
        <form onSubmit={handleTestSend} className="space-y-5">
          <Field label={t("ntRecipientEmail")}>
            <input type="email" required autoFocus value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)}
              placeholder={t("ntPhRecipient")} className={inputCls} style={inputStyle} />
          </Field>
          <Field label={t("ntTestMessage")}>
            <textarea required rows={4} value={testMessage} onChange={(e) => setTestMessage(e.target.value)}
              className={`${inputCls} resize-y`} style={inputStyle} />
          </Field>
          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-end" style={{ borderColor: "var(--border)" }}>
            <button type="submit" disabled={testing || !testRecipient}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-(--accent) px-5 text-sm font-semibold text-white hover:bg-(--accent-hover) disabled:opacity-50">
              {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {testing ? t("ntSending") : t("ntSendTest")}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Notification Logs */}
      <div className="rounded-lg border" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
            <h2 className="nf-text-label-strong" style={{ color: "var(--text-primary)" }}>{t("ntOutboundLogs")}</h2>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-[var(--radius-xs)]" style={{ backgroundColor: "var(--badge-bg)", color: "var(--text-secondary)" }}>
            {logs.length} {t("ntLogEntries")}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <TableHeader>
              <tr className="border-b border-(--row-border)">
                <TableHead className="h-auto p-4 w-12 text-center">#</TableHead>
                <TableHead className="h-auto p-4 w-32">{t("ntColTimestamp")}</TableHead>
                <TableHead className="h-auto p-4 w-24">{t("ntColChannel")}</TableHead>
                <TableHead className="h-auto p-4 w-44">{t("ntColRecipient")}</TableHead>
                <TableHead className="h-auto p-4">{t("ntColMessageDetails")}</TableHead>
                <TableHead className="h-auto p-4 text-center w-24">{t("ntColStatus")}</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <tr>
                  <TableCell colSpan={6} className="p-8 text-center" style={{ color: "var(--text-muted)" }}>
                    {t("ntNoLogs")}
                  </TableCell>
                </tr>
              ) : (
                logs.map((log, idx) => {
                  const isSuccess = log.status === "SUCCESS";
                  return (
                    <TableRow key={log.log_id || idx}>
                      <TableCell className="p-4 text-center font-mono" style={{ color: "var(--text-muted)" }}>{idx + 1}</TableCell>
                      <TableCell className="p-4 font-mono" style={{ color: "var(--text-muted)" }}>
                        {new Date(log.sent_at).toLocaleString(undefined, { hour12: true })}
                      </TableCell>
                      <TableCell className="p-4">
                        {/* Channel is which pipe carried the message, not a
                            status — two colours here implied one was better. */}
                        <Badge variant="neutral">{log.channel}</Badge>
                      </TableCell>
                      <TableCell className="p-4 font-medium font-mono" style={{ color: "var(--text-secondary)" }}>{log.recipient}</TableCell>
                      <TableCell className="p-4">
                        <div style={{ color: "var(--text-primary)" }} className="font-semibold">{log.message}</div>
                        {log.error_message && (
                          <div className="text-[10px] text-rose-500 mt-1 font-mono">{log.error_message}</div>
                        )}
                      </TableCell>
                      <TableCell className="p-4 text-center">
                        <span className={`text-[9px] font-semibold border px-2 py-0.5 rounded-[var(--radius-xs)] inline-flex items-center gap-1 ${
                          isSuccess
                            ? "bg-(--success-muted) text-(--success) border-(--success)"
                            : "bg-(--danger-muted) text-(--danger) border-(--danger)"
                        }`}>
                          {isSuccess ? t("ntSent") : t("ntFailed")}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </table>
        </div>
      </div>
    </ConsolePage>
  );
}
