import brahmanOmLogo from '@/src/assets/images/brahman_om_logo_1794746111823.jpg';

interface ParmanuLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP: Record<NonNullable<ParmanuLogoProps['size']>, string> = {
  xs: 'w-6 h-6 rounded-md',
  sm: 'w-7 h-7 rounded-lg',
  md: 'w-8 h-8 rounded-lg',
  lg: 'w-11 h-11 rounded-xl',
};

export function ParmanuLogo({ size = 'md', className = '' }: ParmanuLogoProps) {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 overflow-hidden shadow-xs ring-1 ring-slate-900/10 dark:ring-white/15 bg-slate-950 ${SIZE_MAP[size]} ${className}`}
    >
      <img
        src={brahmanOmLogo}
        alt="Parmanu mark"
        className="w-full h-full object-cover"
      />
    </span>
  );
}
