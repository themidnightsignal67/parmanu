import { motion } from 'motion/react';
import { ArrowRight, Globe, Lock, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { IndianFlag } from '@/src/components/ui/IndianFlag';
import { ParmanuLogo } from '@/src/components/ui/ParmanuLogo';

export function GoogleSignInGate() {
  const { signInWithGoogle, signingIn, authError } = useAuth();

  return (
    <div className="min-h-screen bg-[#F4F6FA] text-[#0F172A] flex flex-col justify-between relative overflow-hidden">
      {/* Calm Light-Theme Ambient Tricolour + Indigo Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <motion.div
          animate={{ scale: [1, 1.06, 1], opacity: [0.35, 0.5, 0.35] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -top-32 left-1/4 w-[34rem] h-[34rem] rounded-full bg-gradient-to-br from-orange-200/45 via-indigo-100/40 to-emerald-100/35 blur-3xl"
        />
        <motion.div
          animate={{ scale: [1.04, 0.98, 1.04], opacity: [0.28, 0.42, 0.28] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute -bottom-32 right-1/4 w-[32rem] h-[32rem] rounded-full bg-gradient-to-tr from-blue-100/50 via-purple-100/45 to-orange-100/40 blur-3xl"
        />
      </div>

      {/* Subtle Top Tricolour Hairline */}
      <div
        aria-hidden="true"
        className="relative z-10 h-1 w-full bg-gradient-to-r from-[#FF9933] via-white to-[#138808]"
      />

      <div className="relative z-10 flex-1 flex items-center justify-center px-4 sm:px-8 py-12">
        <div className="max-w-lg w-full space-y-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="space-y-4"
          >
            <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-xl bg-white/70 backdrop-blur-md border border-white/40 ring-1 ring-slate-900/5 shadow-xs text-xs font-medium text-slate-600">
              <span className="text-orange-600 font-semibold" aria-hidden="true">
                ॐ
              </span>
              <IndianFlag className="w-4.5 h-3" />
              <span>India’s Atomic OSINT Engine</span>
            </div>

            <div className="flex items-center justify-center gap-3 pt-1">
              <ParmanuLogo size="lg" />
              <span className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-[#0F172A]">
                Parmanu<span className="text-orange-600">.</span>
              </span>
            </div>

            <h1 className="font-display text-xl sm:text-2xl font-semibold text-[#0F172A] tracking-tight">
              One Signal. Every Trace. Zero Blind Spots.
            </h1>

            <p className="text-sm text-slate-500 max-w-md mx-auto leading-relaxed">
              Sign in with Google to save investigation histories, collaborate
              securely with teammates, run continuous exposure alerts, and
              unlock AI Analyst synthesis.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08, ease: 'easeOut' }}
          >
            <Card className="p-7 sm:p-8 space-y-6 text-left">
              <div className="space-y-2 text-center">
                <p className="text-sm font-semibold text-[#0F172A]">
                  Analyst Workspace Sign In
                </p>
                <p className="text-xs text-slate-500">
                  Verified Google account authentication powered by Firebase
                </p>
              </div>

              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={signInWithGoogle}
                disabled={signingIn}
                className="w-full h-12 rounded-xl justify-center gap-3 text-sm font-semibold"
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    fill="#EA4335"
                    d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6 6.8 2.6 2.6 6.8 2.6 12s4.2 9.4 9.4 9.4c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.6H12z"
                  />
                  <path
                    fill="#34A853"
                    d="M3.7 7.3l3.2 2.4C7.7 7.8 9.7 6.4 12 6.4c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.6 12 2.6 8.3 2.6 5.1 4.6 3.7 7.3z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M12 21.4c2.5 0 4.6-.8 6.2-2.3l-2.9-2.3c-.8.5-1.8.9-3.3.9-2.8 0-5.1-1.9-5.9-4.4l-3.2 2.5c1.5 3.3 4.9 5.6 9.1 5.6z"
                  />
                  <path
                    fill="#4285F4"
                    d="M20.8 12.3c0-.6-.1-1.1-.2-1.6H12v3.9h5.4c-.3 1.2-1 2.2-2 2.8l2.9 2.3c1.7-1.6 2.5-3.9 2.5-7.4z"
                  />
                </svg>
                <span>
                  {signingIn ? 'Connecting with Google...' : 'Continue with Google'}
                </span>
                <ArrowRight className="w-4 h-4 opacity-70" />
              </Button>

              {authError && (
                <p className="text-xs text-rose-600 text-center bg-rose-50 border border-rose-200 rounded-xl p-2.5">
                  {authError}
                </p>
              )}

              <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[#F1F5F9] text-[11px] text-slate-500">
                <div className="flex flex-col items-center text-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-orange-600" />
                  <span>Ethical Public OSINT</span>
                </div>
                <div className="flex flex-col items-center text-center gap-1.5">
                  <Globe className="w-4 h-4 text-indigo-600" />
                  <span>Live Telemetry</span>
                </div>
                <div className="flex flex-col items-center text-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>AI Executive Briefs</span>
                </div>
              </div>
            </Card>
          </motion.div>

          <p className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5">
            <Lock className="w-3 h-3" />
            <span>
              Zero-trust private investigation storage · Made by Midnight Industries
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
