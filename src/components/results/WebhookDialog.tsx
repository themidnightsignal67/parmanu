import { useState } from 'react';
import { Bell, CheckCircle2, Loader2, Send } from 'lucide-react';
import type { InvestigationRecord, WebhookConfig } from '@/src/types/investigation';
import { dispatchWebhookAlert } from '@/src/lib/api';
import { loadWebhookConfigs, saveWebhookConfigs } from '@/src/lib/annotationsStore';
import { Dialog } from '@/src/components/ui/Dialog';
import { Button } from '@/src/components/ui/Button';

interface WebhookDialogProps {
  open: boolean;
  onClose: () => void;
  investigation?: InvestigationRecord | null;
  onNotify: (toast: {
    type: 'success' | 'error' | 'info';
    title: string;
    message?: string;
  }) => void;
}

export function WebhookDialog({
  open,
  onClose,
  investigation,
  onNotify,
}: WebhookDialogProps) {
  const [configs, setConfigs] = useState<WebhookConfig[]>(() => loadWebhookConfigs());
  const [provider, setProvider] = useState<WebhookConfig['provider']>('slack');
  const [url, setUrl] = useState('');
  const [sending, setSending] = useState(false);

  const handleSaveAndDispatch = async (
    targetUrl: string,
    targetProvider: WebhookConfig['provider'],
    isTest: boolean
  ) => {
    const trimmed = targetUrl.trim();
    if (!trimmed.startsWith('https://')) {
      onNotify({
        type: 'error',
        title: 'HTTPS Webhook URL Required',
        message: 'Enter a valid public https:// webhook endpoint.',
      });
      return;
    }

    if (trimmed && !configs.some((c) => c.url === trimmed)) {
      const next: WebhookConfig[] = [
        {
          id: `wh_${Date.now()}`,
          label: `${targetProvider.toUpperCase()} Alert`,
          provider: targetProvider,
          url: trimmed,
          enabled: true,
        },
        ...configs,
      ].slice(0, 6);
      setConfigs(next);
      saveWebhookConfigs(next);
    }

    setSending(true);
    try {
      const summary = isTest || !investigation
        ? 'Parmanu OSINT webhook connectivity verification alert.'
        : `${investigation.summary.found} verified matches · ${investigation.summary.breached} breached accounts · Risk: ${investigation.aiSummary?.riskPosture || 'Evaluated'}`;

      const res = await dispatchWebhookAlert({
        url: trimmed,
        provider: targetProvider,
        payload: {
          title: isTest
            ? 'Parmanu Webhook Test'
            : `Parmanu Case Alert: ${investigation?.target || 'Investigation'}`,
          target: investigation?.target || 'test-verification',
          targetType: investigation?.targetType || 'system',
          summary,
          scanId: investigation?.scanId,
          breachedCount: investigation?.summary.breached ?? 0,
          foundCount: investigation?.summary.found ?? 0,
        },
      });

      onNotify({
        type: res.ok ? 'success' : 'error',
        title: res.ok ? 'Webhook Delivered' : 'Webhook Delivery Warning',
        message: res.message,
      });
    } catch (err) {
      onNotify({
        type: 'error',
        title: 'Webhook Dispatch Failed',
        message: err instanceof Error ? err.message : 'Unable to send webhook.',
      });
    } finally {
      setSending(false);
    }
  };

  const removeConfig = (id: string) => {
    const next = configs.filter((c) => c.id !== id);
    setConfigs(next);
    saveWebhookConfigs(next);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Webhook Alerts (Slack / Discord / JSON)"
      description="Dispatch case findings or monitoring notifications securely via server-side HTTPS webhook delivery."
      maxWidthClass="max-w-lg"
    >
      <div className="space-y-5">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'slack', label: 'Slack' },
              { id: 'discord', label: 'Discord' },
              { id: 'json', label: 'Custom JSON' },
            ] as const).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setProvider(p.id)}
                className={`py-2 px-3 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                  provider === p.id
                    ? 'bg-[#0F172A] dark:bg-indigo-600 text-white border-transparent'
                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/... or Discord webhook URL"
            className="w-full h-10 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/70 text-xs font-mono text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
          />

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={sending || !url.trim()}
              onClick={() => handleSaveAndDispatch(url, provider, true)}
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
              <span>Test Endpoint</span>
            </Button>
            {investigation && (
              <Button
                size="sm"
                disabled={sending || !url.trim()}
                onClick={() => handleSaveAndDispatch(url, provider, false)}
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>Send Case Alert</span>
              </Button>
            )}
          </div>
        </div>

        {configs.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
              Saved Webhook Endpoints
            </p>
            <div className="space-y-2">
              {configs.map((cfg) => (
                <div
                  key={cfg.id}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-[#0F172A] dark:text-slate-100 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span>{cfg.provider.toUpperCase()}</span>
                    </p>
                    <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {cfg.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={sending}
                      onClick={() =>
                        handleSaveAndDispatch(cfg.url, cfg.provider, !investigation)
                      }
                    >
                      Send
                    </Button>
                    <button
                      type="button"
                      onClick={() => removeConfig(cfg.id)}
                      className="px-2 py-1 text-[11px] text-rose-600 hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
