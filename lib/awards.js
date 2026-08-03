// Hạng mục giải thưởng (kiểu Grammy) — GỢI Ý cho ô nhập ở admin, không phải enum:
// admin nhập tự do, thêm hạng mục mới không cần sửa code.
// type = đối tượng được trao: 'track' (bài hát) hoặc 'artist' (nghệ sĩ).
export const AWARD_CATEGORIES = [
  { name: 'Song of the Year', type: 'track' },
  { name: 'Record of the Year', type: 'track' },
  { name: 'Best New Song', type: 'track' },
  { name: 'Best Collaboration', type: 'track' },
  { name: 'Best Pop Song', type: 'track' },
  { name: 'Best Hip-Hop/Rap Song', type: 'track' },
  { name: 'Best R&B/Soul Song', type: 'track' },
  { name: 'Best Rock Song', type: 'track' },
  { name: 'Best Dance/Electronic Song', type: 'track' },
  { name: 'Best Ballad', type: 'track' },
  { name: 'Best K-Pop Song', type: 'track' },
  { name: 'Best V-Pop Song', type: 'track' },
  { name: 'Most Streamed Song', type: 'track' },
  { name: 'Longest No.1 Run', type: 'track' },
  { name: 'Artist of the Year', type: 'artist' },
  { name: 'Best New Artist', type: 'artist' },
  { name: 'Male Artist of the Year', type: 'artist' },
  { name: 'Female Artist of the Year', type: 'artist' },
  { name: 'Group of the Year', type: 'artist' },
];

export const AWARD_TYPES = [
  { value: 'track', label: 'Song' },
  { value: 'artist', label: 'Artist' },
];

// Hạng mục đã biết -> gợi ý sẵn type (admin vẫn đổi được).
export function categoryType(name) {
  const n = String(name || '').trim().toLowerCase();
  return AWARD_CATEGORIES.find((c) => c.name.toLowerCase() === n)?.type || '';
}
