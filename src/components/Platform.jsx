import { useState } from 'react';
import { platformLogo } from '../config/platforms';

export function PlatformLogo({ platform, size = 22 }) {
  const [err, setErr] = useState(false);
  if (!platform || err) return null;
  return <img className="platform-logo" src={platformLogo(platform)} alt="" width={size} height={size} loading="lazy" onError={() => setErr(true)} />;
}

export function PlatformTitle({ platform, text }) {
  return (
    <span className="platform-title">
      <PlatformLogo platform={platform} />
      {text}
    </span>
  );
}
