import mongoose from 'mongoose';

// 1 doc = kết quả của 1 track trong 1 tuần của 1 năm.
const EntrySchema = new mongoose.Schema(
  {
    year: { type: Number, required: true },
    week: { type: Number, required: true, min: 1 },
    trackId: { type: String, required: true, ref: 'Track' },
    rank: { type: Number, default: null }, // null = có stream nhưng không nằm trên chart hiển thị
    stream: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Chống trùng: mỗi (năm, tuần, track) chỉ 1 bản ghi.
EntrySchema.index({ year: 1, week: 1, trackId: 1 }, { unique: true });
// Liệt kê bảng xếp hạng 1 tuần theo thứ hạng.
EntrySchema.index({ year: 1, week: 1, rank: 1 });
// Lịch sử 1 track theo thời gian.
EntrySchema.index({ trackId: 1, year: 1, week: 1 });

export default mongoose.models.Entry || mongoose.model('Entry', EntrySchema);