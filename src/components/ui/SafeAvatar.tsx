import { useEffect, useState } from 'react';
import { getAvatarImageUrl } from '@/src/lib/api';

interface SafeAvatarProps {
  src?: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}

export function SafeAvatar({
  src,
  alt,
  className = '',
  fallback = null,
}: SafeAvatarProps) {
  const proxied = getAvatarImageUrl(src);
  const direct = src?.trim().startsWith('//') ? `https:${src.trim()}` : src?.trim();

  const [mode, setMode] = useState<'proxy' | 'direct' | 'failed'>(
    proxied ? 'proxy' : 'failed'
  );

  useEffect(() => {
    setMode(proxied ? 'proxy' : 'failed');
  }, [proxied, src]);

  if (!src || mode === 'failed') {
    return <>{fallback}</>;
  }

  const activeSrc =
    mode === 'proxy'
      ? proxied
      : direct && direct !== proxied
      ? direct
      : undefined;

  if (!activeSrc) {
    return <>{fallback}</>;
  }

  return (
    <img
      key={activeSrc}
      src={activeSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="eager"
      decoding="async"
      onError={() => {
        if (mode === 'proxy' && direct && direct !== proxied) {
          setMode('direct');
        } else {
          setMode('failed');
        }
      }}
      className={className}
    />
  );
}
