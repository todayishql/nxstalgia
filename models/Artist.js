import mongoose from 'mongoose';

// 1 doc = 1 nghệ sĩ. Key theo TÊN chuẩn hoá (artistKey) vì catalog gom nghệ sĩ theo tên,
// aid trên Track hiện còn thưa. Metadata điền tay/bulk ở /admin/artists.
const ArtistSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // = artistKey(name): tên thường hoá, gộp khoảng trắng
    name: { type: String, required: true, trim: true }, // tên hiển thị (dạng thấy đầu tiên)
    gender: {
      type: String,
      enum: ['male', 'female', 'group', 'other', ''], // group = band/girl-group/boy-group/mixed
      default: '',
    },
    region: {
      type: String,
      enum: ['ASIA', 'US-UK', 'OTHER', ''],
      default: '',
    },
    genres: { type: [String], default: [] }, // thể loại định danh nghệ sĩ (khác genre của từng track)
    imageUrl: { type: String, default: '' },
  },
  { timestamps: true, _id: false }
);

ArtistSchema.index({ gender: 1 });
ArtistSchema.index({ region: 1 });

export default mongoose.models.Artist || mongoose.model('Artist', ArtistSchema);
