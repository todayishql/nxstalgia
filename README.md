# nxstalgia — N[26]stalgia Backend + Admin (Next.js + MongoDB)

Backend API và trang quản trị dữ liệu cho bảng xếp hạng nhạc cá nhân **THE N[26]stalgia**.
Stack: **Next.js (App Router)** + **MongoDB/Mongoose** + **JWT (cookie httpOnly)**.

## Cài đặt

```bash
git clone https://github.com/todayishql/nxstalgia.git
cd nxstalgia
npm install
cp .env.local.example .env.local     # rồi sửa giá trị
```

`.env.local` cần:
- `MONGODB_URI` — MongoDB local hoặc Atlas
- `JWT_SECRET` — chuỗi ngẫu nhiên dài (`openssl rand -hex 32`)
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — cho lệnh tạo admin

Cần có MongoDB đang chạy (local: cài MongoDB Community, hoặc dùng MongoDB Atlas free tier).

## Nạp dữ liệu & tạo admin

```bash
npm run import-seed     # nhập SEED (446 track + entries) vào MongoDB
npm run create-admin    # tạo tài khoản admin từ ADMIN_EMAIL/ADMIN_PASSWORD
```

(Không chạy `create-admin` cũng được — lần đầu vào `/admin/login` bấm “Đăng ký admin đầu tiên”.)

## Chạy

```bash
npm run dev             # http://localhost:3000
# hoặc production:
npm run build && npm run start
```

- Trang admin: **http://localhost:3000/admin**
- API công khai: **http://localhost:3000/api/bootstrap**

## Chạy bằng Docker / OrbStack

Đóng gói sẵn app Next.js + MongoDB, tự chứa (không cần cài Node/Mongo trên máy).

```bash
cd nxstalgia
cp .env.docker.example .env     # đặt JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build    # OrbStack chạy được lệnh docker chuẩn
```

Lần đầu, seed dữ liệu + tạo admin **bên trong container** (env đã có sẵn trong container):

```bash
docker compose exec app node scripts/import-seed.mjs
docker compose exec app node scripts/create-admin.mjs
```

- App: **http://localhost:3000** — admin: **http://localhost:3000/admin**
- MongoDB: cổng `27017` (dữ liệu lưu ở volume `mongo-data`, không mất khi tắt container).

Lệnh hữu ích:
```bash
docker compose logs -f app        # xem log app
docker compose ps                 # trạng thái
docker compose down               # dừng (giữ dữ liệu)
docker compose down -v            # dừng + XOÁ dữ liệu mongo
```

**Dùng MongoDB Atlas thay cho mongo container:** thêm `MONGODB_URI=mongodb+srv://...` vào `.env`
(compose sẽ ưu tiên biến này); có thể xoá service `mongo` + `depends_on` trong `docker-compose.yml`.

> Lưu ý: nếu host đã có tiến trình khác chiếm cổng 3000 (vd `next dev` chạy dở), port publish của
> container sẽ không gắn được — tắt tiến trình đó rồi `docker compose up -d --force-recreate app`.

## Schema (MongoDB collections)

| Collection | Mô tả | Chỉ mục chính |
|---|---|---|
| `tracks` | metadata bài hát, `artists[]` (tách collab), `baseline`, `artworkUrl/Status` | `_id` (string), `artist`, `artworkStatus` |
| `entries` | 1 doc = 1 track trong 1 tuần: `{year, week, trackId, rank, stream}` | unique `(year,week,trackId)`; `(year,week,rank)`; `(trackId,year,week)` |
| `settings` | singleton `config`: chartName, currentYear, weeksPerYear | `_id='config'` |
| `users` | tài khoản admin (bcrypt) | `email` unique |

> Thống kê (peakScore, total, streak, woc, peakRank) **không lưu** — tính lại từ `entries`.

## API

**Công khai**
- `GET /api/bootstrap` → `{ settings, tracks[], entries[] }` (cho public viewer)

**Auth**
- `POST /api/auth/login` `{email,password}` → set cookie
- `POST /api/auth/register` `{email,password,name}` (user đầu tiên = bootstrap; sau đó cần đăng nhập)
- `POST /api/auth/logout`
- `GET  /api/auth/me`

**Admin** (cần cookie đăng nhập)
- `GET/POST /api/admin/tracks`, `PUT/DELETE /api/admin/tracks/:id`
- `GET/PUT  /api/admin/chart/:year/:week` (PUT = thay thế toàn bộ tuần)
- `POST /api/admin/artwork` (tra hàng loạt bài pending), `POST /api/admin/artwork/:id` (1 bài)
- `GET  /api/admin/stats`

## Trang admin

- **Tổng quan** — số liệu + nút tra ảnh bìa iTunes hàng loạt.
- **Bài hát** — thêm/sửa/xoá track, tra ảnh từng bài.
- **Bảng xếp hạng** — chọn năm/tuần, nhập rank + stream từng bài, lưu (thay thế cả tuần).

## Ảnh bìa iTunes (fix bug collab)

Ảnh bìa được tra **phía server** dùng **nghệ sĩ chính** (`artists[0]`), nên xử lý được cả
bài collab có dấu phẩy (`"Taylor Swift, Sabrina Carpenter"`). Thử lần lượt:
`tên bài + nghệ sĩ chính` → `tên bài + artist gốc` → `chỉ tên bài`.
Logic ở `lib/itunes.js` + `lib/artists.js`.

## Ghi chú

- **Public viewer** (trang xem bảng xếp hạng đầy đủ) phục vụ tại `/` — tĩnh trong `public/viewer/`,
  đọc dữ liệu từ `/api/bootstrap` (MongoDB). Chế độ chỉ-xem; chỉnh sửa dữ liệu làm ở `/admin`.
  Ảnh bìa lấy từ trường `artworkUrl` (server tra iTunes) — chạy "Tra ảnh" trong admin để điền.
- Auth verify chạy trong Node runtime (route handlers), không dùng middleware edge.

## Cấu trúc thư mục

```
app/            # Next.js App Router: layout, admin UI, API routes
  admin/        # trang quản trị (login, tracks, chart, tổng quan)
  api/          # bootstrap, auth, admin (tracks/chart/artwork/stats)
lib/            # mongodb, auth (JWT/bcrypt), itunes, artists, api client
models/         # Mongoose schema: Track, Entry, Settings, User
scripts/        # import-seed, create-admin, seed-data (446 track)
public/viewer/  # public viewer tĩnh (đọc /api/bootstrap)
Dockerfile, docker-compose.yml   # đóng gói app + MongoDB
```