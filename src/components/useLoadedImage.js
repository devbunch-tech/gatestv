import { useEffect, useState } from 'react';
import { cachedImg } from '../lib/imgcache';

// Só troca a imagem de fundo depois que a nova terminou de baixar (uma vez por imagem),
// evitando que o fundo pisque ou carregue várias versões em sequência.
export function useLoadedImage(rawUrl, ready = true) {
  const url = rawUrl && !rawUrl.startsWith('/img?') ? cachedImg(rawUrl) : rawUrl;
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!ready || !url) return;
    let alive = true;
    const im = new Image();
    im.onload = () => alive && setShown(url);
    im.src = url;
    return () => {
      alive = false;
    };
  }, [url, ready]);
  return shown;
}
