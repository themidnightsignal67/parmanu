import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({
  interactive = false,
  className = '',
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={`bg-white/75 dark:bg-[#0E1526]/85 backdrop-blur-xl border border-white/50 dark:border-slate-800/80 ring-1 ring-slate-900/5 dark:ring-white/5 rounded-2xl shadow-[0_4px_20px_-2px_rgba(15,23,42,0.04)] dark:shadow-[0_10px_30px_-4px_rgba(0,0,0,0.45)] ${
        interactive
          ? 'transition-all duration-150 hover:border-white/80 dark:hover:border-slate-700 hover:bg-white/85 dark:hover:bg-[#131C33]/90 hover:shadow-[0_8px_28px_-4px_rgba(15,23,42,0.08)] cursor-pointer'
          : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
