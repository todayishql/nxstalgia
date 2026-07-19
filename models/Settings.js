import mongoose from 'mongoose';

// Doc singleton (_id: 'config') giữ cấu hình chung.
const SettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'config' },
    chartName: { type: String, default: 'THE N[26]stalgia' },
    currentYear: { type: Number, default: 2026 },
    weeksPerYear: { type: Number, default: 52 },
  },
  { _id: false, timestamps: true }
);

export default mongoose.models.Settings ||
  mongoose.model('Settings', SettingsSchema);