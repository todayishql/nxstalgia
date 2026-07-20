// Tiện ích cho ô nhập số ở admin: hiển thị số nguyên có dấu phẩy ngăn cách nghìn.

// Định dạng giá trị (số hoặc chuỗi) thành "1,234,567" để hiển thị. Rỗng -> ''.
export function groupInt(v) {
  if (v === '' || v == null) return '';
  const digits = String(v).replace(/[^\d]/g, '');
  return digits === '' ? '' : Number(digits).toLocaleString('en-US');
}

// Lấy chuỗi chữ số thô (bỏ dấu phẩy và ký tự khác) để lưu vào state / gửi API.
export function onlyDigits(v) {
  return String(v ?? '').replace(/[^\d]/g, '');
}