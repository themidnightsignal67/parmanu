import React, { useEffect, useState } from 'react';
import { RefreshCw, Send, Sparkles } from 'lucide-react';
import {
  askInvestigationAnalyst,
  regenerateInvestigationBrief,
} from '@/src/lib/api';
import type { InvestigationRecord } from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Dialog } from '@/src/components/ui/Dialog';

interface AiAnalystDialogProps {
  open: boolean;
  onClose: () => void;
  investigation: InvestigationRecord;
  onUpdateInvestigation: (record: InvestigationRecord) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  meta?: string;
}

export function AiAnalystDialog({
  open,
  onClose,
  investigation,
  onUpdateInvestigation,
}: AiAnalystDialogProps) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    setMessages([]);
    setRegenError(null);
    setQuestion('');
  }, [investigation.scanId]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setRegenError(null);
    try {
      const updated = await regenerateInvestigationBrief(
        investigation.scanId,
        investigation
      );
      onUpdateInvestigation(updated);
    } catch (err) {
      setRegenError(
        err instanceof Error
          ? err.message
          : 'Could not refresh executive summary.'
      );
    } finally {
      setRegenerating(false);
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || asking) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setAsking(true);

    try {
      const res = await askInvestigationAnalyst(
        investigation.scanId,
        trimmed,
        investigation
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: res.answer,
          meta:
            res.keySlotUsed > 0
              ? `AI Slot ${res.keySlotUsed}/${res.keyPoolSize}`
              : undefined,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text:
            err instanceof Error
              ? err.message
              : 'Unable to reach AI Analyst right now.',
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const summary = investigation.aiSummary;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="AI Analyst"
      description={`Parmanu intelligence synthesis for ${investigation.target} (${investigation.targetType})`}
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-5">
        {/* Executive Summary Block */}
        <div className="p-4 rounded-xl bg-gradient-to-br from-orange-50/40 via-blue-50/50 to-purple-50/60 dark:from-orange-950/25 dark:via-indigo-950/35 dark:to-purple-950/30 border border-indigo-100 dark:border-indigo-900/60 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                Executive Summary · Exposure Posture:{' '}
                {summary?.riskPosture || 'Low'}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={regenerating}
              onClick={handleRegenerate}
            >
              <RefreshCw
                className={`w-3 h-3 ${regenerating ? 'animate-spin' : ''}`}
              />
              <span>Refresh Summary</span>
            </Button>
          </div>

          <p className="text-sm text-[#0F172A] dark:text-slate-100 leading-relaxed">
            {summary?.executiveBrief ||
              'Generating concise intelligence summary across verified results...'}
          </p>

          {regenError && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{regenError}</p>
          )}

          {summary && summary.keyTakeaways.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-indigo-100/80 dark:border-indigo-900/50 text-xs">
              <div className="space-y-1.5">
                <p className="font-semibold text-[#0F172A] dark:text-slate-100">Key Insights</p>
                <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                  {summary.keyTakeaways.map((item, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-orange-500">·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-1.5">
                <p className="font-semibold text-[#0F172A] dark:text-slate-100">Next Steps</p>
                <ul className="space-y-1 text-slate-600 dark:text-slate-300">
                  {summary.recommendedNextSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-indigo-500">·</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Interactive Q&A Thread */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Ask Follow-Up Questions
          </p>

          {messages.length > 0 && (
            <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`p-3 rounded-xl text-xs leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-[#0F172A] dark:bg-indigo-600 text-white ml-8'
                      : 'bg-[#F8FAFC] dark:bg-slate-900 border border-[#E5E7EB] dark:border-slate-800 text-slate-700 dark:text-slate-200 mr-8'
                  }`}
                >
                  <p>{m.text}</p>
                  {m.meta && (
                    <p className="text-[11px] text-slate-400 mt-1">{m.meta}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAsk} className="flex items-center gap-2">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about linked accounts, breaches, or timeline..."
              className="flex-1 h-10 px-3.5 rounded-xl border border-[#E5E7EB] dark:border-slate-700 bg-[#FAFAFA] dark:bg-slate-900 text-sm text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
            <Button
              type="submit"
              variant="gradient"
              size="md"
              disabled={!question.trim() || asking}
            >
              <Send className="w-3.5 h-3.5" />
              <span>{asking ? 'Analyzing...' : 'Ask'}</span>
            </Button>
          </form>
        </div>
      </div>
    </Dialog>
  );
}
