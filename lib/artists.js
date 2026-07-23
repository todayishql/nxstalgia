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

// Khoá chuẩn hoá cho 1 nghệ sĩ: thường hoá + gộp khoảng trắng (giữ dấu tiếng Việt).
// Dùng làm _id của Artist và để join metadata theo tên ở cả admin lẫn viewer.
export function artistKey(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Nhãn hiển thị cho gender/region (dùng chung admin + viewer).
export const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'group', label: 'Group' }, // band / girl-group / boy-group / mixed
  { value: 'other', label: 'Other' },
];
export const REGIONS = [
  { value: 'ASIA', label: 'ASIA' },
  { value: 'US-UK', label: 'US-UK' },
  { value: 'OTHER', label: 'Other' },
];