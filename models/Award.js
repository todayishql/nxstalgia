import mongoose from 'mongoose';

// 1 doc = 1 đề cử trong 1 hạng mục của 1 năm (won=true -> người thắng).
// subject trỏ tới bài hát (Track._id) hoặc nghệ sĩ (artistKey) tuỳ type.
const AwardSchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    category: { type: String, required: true, trim: true }, // nhập tự do, gợi ý ở lib/awards.js
    type: { type: String, enum: ['track', 'artist'], required: true },
    subject: { type: String, required: true }, // trackId ("S252") hoặc artistKey ("taylor swift")
    name: { type: String, default: '', trim: true }, // tên hiển thị lúc lưu (nghệ sĩ); track tra từ Track
    won: { type: Boolean, default: false }, // false = nominee
    note: { type: String, default: '', trim: true },
  },
  { timestamps: true }
);

// Chống trùng: 1 đối tượng chỉ xuất hiện 1 lần trong 1 hạng mục của 1 năm.
AwardSchema.index({ year: 1, category: 1, subject: 1 }, { unique: true });
// Liệt kê theo năm (winner lên trước).
AwardSchema.index({ year: 1, category: 1, won: -1 });
// Tra ngược: bài hát / nghệ sĩ này đã có những title nào.
AwardSchema.index({ subject: 1, year: 1 });

export default mongoose.models.Award || mongoose.model('Award', AwardSchema);
