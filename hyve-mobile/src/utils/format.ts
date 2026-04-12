export function fmt(n: number | undefined | null): string {
  if (n == null || isNaN(n)) return '—';
  const s = Math.floor(n).toString();
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtHyve(raw: number | string | undefined | null, decimals = 4): string {
  if (raw == null) return '—';
  const v = typeof raw === 'string' ? parseFloat(raw) : raw;
  if (isNaN(v)) return '—';
  return v.toFixed(decimals);
}

export function shortenAddr(addr: string, chars = 8): string {
  if (!addr || addr.length < chars * 2 + 2) return addr;
  return addr.slice(0, chars + 2) + '…' + addr.slice(-chars);
}

export function shortenHash(hash: string, chars = 6): string {
  if (!hash || hash.length < chars * 2) return hash;
  return hash.slice(0, chars) + '…' + hash.slice(-chars);
}

export function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function mbStr(bytes: number | undefined | null): string {
  if (bytes == null || isNaN(bytes)) return '— MB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
