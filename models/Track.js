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
    artworkUrl: { type: String, default: '' },
    artworkStatus: {
      type: String,
      enum: ['pending', 'ok', 'none'],
      default: 'pending',
    },
  },
  { timestamps: true, _id: false }
);

TrackSchema.index({ artist: 1 });
TrackSchema.index({ artworkStatus: 1 });

export default mongoose.models.Track || mongoose.model('Track', TrackSchema);
