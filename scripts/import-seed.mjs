// Nhập dữ liệu SEED (446 track) vào MongoDB.
// Chạy: npm run import-seed  (nạp env qua --env-file=.env.local)
import mongoose from 'mongoose';
import { SEED } from './seed-data.mjs';
import { splitArtists } from '../lib/artists.js';
import Track from '../models/Track.js';
import Entry from '../models/Entry.js';
import Settings from '../models/Settings.js';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Thiếu MONGODB_URI (tạo .env.local từ .env.local.example)');
  process.exit(1);
}

const YEAR = SEED.year || 2026;

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log('Đã kết nối MongoDB. Bắt đầu import năm', YEAR);

  const trackOps = [];
  const entryOps = [];
  for (const t of SEED.tracks) {
    trackOps.push({
      updateOne: {
        filter: { _id: t.id },
        update: {
          $set: {
            aid: t.aid || '',
            name: t.name,
            artist: t.artist,
            artists: splitArtists(t.artist),
          },
          // chỉ đặt khi tạo mới, không đè cấu hình đã có
          $setOnInsert: { baseline: 0, artworkStatus: 'pending', artworkUrl: '' },
        },
        upsert: true,
      },
    });
    for (const w of t.weeks || []) {
      const [week, rank, stream] = w;
      entryOps.push({
        updateOne: {
          filter: { year: YEAR, week, trackId: t.id },
          update: { $set: { rank: rank == null ? null : rank, stream: stream || 0 } },
          upsert: true,
        },
      });
    }
  }

  console.log(`Ghi ${trackOps.length} tracks...`);
  if (trackOps.length) await Track.bulkWrite(trackOps, { ordered: false });
  console.log(`Ghi ${entryOps.length} entries...`);
  // chia lô để tránh payload quá lớn
  for (let i = 0; i < entryOps.length; i += 1000) {
    await Entry.bulkWrite(entryOps.slice(i, i + 1000), { ordered: false });
    process.stdout.write(`  ${Math.min(i + 1000, entryOps.length)}/${entryOps.length}\r`);
  }
  console.log('');

  await Settings.findByIdAndUpdate(
    'config',
    { $setOnInsert: { chartName: 'THE N[26]stalgia', currentYear: YEAR, weeksPerYear: 52 } },
    { upsert: true }
  );

  const [tc, ec] = await Promise.all([Track.countDocuments(), Entry.countDocuments()]);
  console.log(`Xong. tracks=${tc}, entries=${ec}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});