import mongoose from 'mongoose';

const TrackSchema = new mongoose.Schema(
  {
    // _id chính là track id ổn định dạng chuỗi (vd "S252"), không dùng ObjectId
    _id: { type: String, required: true },
    aid: { type: String, default: '' }, // id nghệ sĩ (nhóm theo nghệ sĩ)
    name: { type: String, required: true, trim: true },
    artist: { type: String, required: true, trim: true }, // hiển thị nguyên văn
    artists: { type: [String], default: [] }, // tách sẵn -> fix ảnh bìa collab + nhóm nghệ sĩ
    baseline: { type: Number, default: 0 }, // stream tích luỹ trước khi lên chart
    genre: { type: String, default: '', trim: true }, // thể loại; auto-fill từ iTunes khi tra ảnh bìa
    artworkUrl: { type: String, default: '' },
    artworkStatus: {
      type: String,
      enum: ['pending', 'ok', 'none'],
      default: 'pending',
    },
    genre: { type: String, default: '', trim: true }, // thể loại — dùng cho biểu đồ phân bố genre ở tab All-time
    region: {
      // khu vực nghệ sĩ — dùng để lọc Bảng vàng All-time
      type: String,
      enum: ['', 'US-UK', 'ASIA'],
      default: '',
    },
  },
  { timestamps: true, _id: false }
);

TrackSchema.index({ artist: 1 });
TrackSchema.index({ artworkStatus: 1 });
TrackSchema.index({ region: 1 });

export default mongoose.models.Track || mongoose.model('Track', TrackSchema);
