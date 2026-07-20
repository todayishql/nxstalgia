// Tiện ích chống trùng bài hát + sinh track id tự động.

// Khoá chuẩn hoá để phát hiện trùng: "name|artist" (thường hoá + gộp khoảng trắng).
// Giữ nguyên dấu tiếng Việt (khác dấu = khác bài).
export function songKey(name, artist) {
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${norm(name)}|${norm(artist)}`;
}

// Tạo bộ sinh id dạng S### không trùng với các id đang có (dùng cho cả tạo lẻ và import lô).
// existingIds: mảng id hiện có. Trả về hàm gọi mỗi lần -> id mới, tự tăng.
export function makeIdGen(existingIds) {
  const taken = new Set((existingIds || []).map(String));
  let n = 0;
  for (const id of taken) {
    const m = /^S0*(\d+)$/.exec(id);
    if (m) n = Math.max(n, parseInt(m[1], 10));
  }
  return () => {
    let id;
    do {
      n += 1;
      id = 'S' + String(n).padStart(3, '0');
    } while (taken.has(id));
    taken.add(id);
    return id;
  };
}