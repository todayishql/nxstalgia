import './globals.css';

export const metadata = {
  title: 'THE N[26]stalgia — Admin',
  description: 'Quản trị dữ liệu bảng xếp hạng',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}