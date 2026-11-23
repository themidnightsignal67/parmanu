import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Ignore benign Chromium ResizeObserver loop notifications triggered during fluid layout animations
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    if (
      event.message ===
        'ResizeObserver loop completed with undelivered notifications.' ||
      event.message === 'ResizeObserver loop limit exceeded'
    ) {
      event.stopImmediatePropagation();
      event.preventDefault();
    }
  });
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F4F6FA] flex items-center justify-center p-6 text-[#0F172A]">
          <div className="max-w-md w-full rounded-2xl bg-white/80 backdrop-blur-md border border-white/50 ring-1 ring-slate-900/5 shadow-lg p-7 text-center space-y-4">
            <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200/80 text-orange-600 font-display font-bold flex items-center justify-center mx-auto">
              ॐ
            </div>
            <div className="space-y-1.5">
              <h1 className="font-display text-lg font-bold">
                Workspace Recovery
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                {this.state.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Reload Parmanu
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
