// Tách chuỗi nghệ sĩ collab thành mảng. Dùng cho:
//  - artists[] trong DB
//  - lấy nghệ sĩ chính (artists[0]) khi tra ảnh bìa iTunes
// Cắt tại: dấu phẩy, &, x (đứng riêng), feat/ft, with, và, ;, /
const SPLIT_RE = /\s*(?:,|&|\bx\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bvà\b|;|\/)\s*/i;

export function splitArtists(artist) {
  if (!artist) return [];
  return String(artist)
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function primaryArtist(artist) {
  const parts = splitArtists(artist);
  return parts[0] || '';
}